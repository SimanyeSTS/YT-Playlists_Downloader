#!/usr/bin/env node

import { Command } from 'commander';
import ora from 'ora';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { validateAndExtractId, fetchPlaylistMetadata } from './services/youtube/fetcher.js';
import { downloadSongs } from './services/downloader/downloader.js';
import { addMetadataToFiles } from './services/metadata/tagger.js';
import { createZip, getDirectorySize } from './services/zipper/zipper.js';
import { logger } from './utils/logger.js';
import type { DownloadProgress } from './types/index.js';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('yt-playlist-downloader')
  .description('Download YouTube Music playlists/albums as high-quality MP3s')
  .version('1.0.0');

program
  .argument('<url>', 'YouTube Music playlist or album URL')
  .option('-o, --output <dir>', 'Output directory for downloads', path.join(process.cwd(), 'downloads'))
  .option('--temp-dir <dir>', 'Temporary directory for processing (use different dirs for parallel downloads)', path.join(process.cwd(), '.temp'))
  .option('-c, --concurrency <number>', 'Number of concurrent downloads', '5')
  .option('--cookies <file>', 'Path to cookies.txt file for private/age-restricted content')
  .option('--no-zip', 'Skip creating ZIP archive')
  .option('--no-metadata', 'Skip adding metadata tags')
  .action(async (url: string, options) => {
    const spinner = ora('Initializing...').start();
    logger.setSpinner(spinner);

    try {
      // Step 1: Validate URL and extract playlist ID
      spinner.text = 'Validating URL...';
      const playlistId = await validateAndExtractId(url);
      spinner.succeed(`Valid playlist ID: ${playlistId}`);

      // Step 2: Fetch playlist metadata
      spinner.start('Fetching playlist metadata...');
      const playlist = await fetchPlaylistMetadata(playlistId, options.cookies);
      spinner.succeed(`Found playlist: "${playlist.name}" with ${playlist.totalCount} songs`);

      // Create temp directory for downloads
      const uniqueSuffix = Date.now();
      const tempDir = options.tempDir 
        ? path.join(options.tempDir, `${uniqueSuffix}`)
        : path.join(options.output, `.temp_${uniqueSuffix}`);
      fs.mkdirSync(tempDir, { recursive: true });

      // Step 3: Download songs
      spinner.stop();
      console.log(`\n📥 Downloading ${playlist.songs.length} songs (concurrency: ${options.concurrency})...\n`);
      
      let completed = 0;
      let failed = 0;
      
      const downloadResults = await downloadSongs(playlist.songs, {
        outputDir: tempDir,
        concurrency: parseInt(options.concurrency, 10),
        cookiesFile: options.cookies,
        onProgress: (progress: DownloadProgress) => {
          if (progress.status === 'completed') {
            completed++;
            console.log(`✅ [${completed + failed}/${playlist.songs.length}] ${progress.title}`);
          } else if (progress.status === 'failed') {
            failed++;
            console.log(`❌ [${completed + failed}/${playlist.songs.length}] ${progress.title} - ${progress.error}`);
          } else if (progress.status === 'downloading') {
            process.stdout.write(`\r⬇️  Downloading: ${progress.title}...`.padEnd(80));
          } else if (progress.status === 'converting') {
            process.stdout.write(`\r🎵 Converting: ${progress.title}...`.padEnd(80));
          }
        },
      });
      
      console.log('\n');
      spinner.start('Finalizing...');

      const successfulDownloads = downloadResults.filter((r) => r.success);
      const failedDownloads = downloadResults.filter((r) => !r.success);

      if (successfulDownloads.length === 0) {
        spinner.fail('No songs were downloaded successfully');
        process.exit(1);
      }

      spinner.succeed(`Downloaded ${successfulDownloads.length}/${playlist.songs.length} songs`);

      // Log failed downloads
      if (failedDownloads.length > 0) {
        logger.warn('\nFailed downloads:');
        failedDownloads.forEach((result) => {
          logger.error(`  - ${result.song.title}: ${result.error}`);
        });
      }

      // Step 4: Add metadata
      if (options.metadata) {
        spinner.start('Adding metadata tags...');
        await addMetadataToFiles(
          successfulDownloads.map((result) => ({
            filePath: result.filePath,
            song: result.song,
          }))
        );
        spinner.succeed('Metadata added');
      }

      // Step 5: Create ZIP
      let finalPath = tempDir;
      
      if (options.zip) {
        spinner.start('Creating ZIP archive...');
        
        // Use uploader in name if available: "Album Name — Artist"
        const zipName = playlist.uploader 
          ? `${playlist.name} — ${playlist.uploader}`
          : playlist.name;
        
        const zipResult = await createZip({
          sourceDir: tempDir,
          outputDir: options.output,
          zipName: zipName,
        });
        
        const sizeMB = (zipResult.totalSize / (1024 * 1024)).toFixed(2);
        spinner.succeed(`ZIP created: ${zipResult.zipPath} (${sizeMB} MB)`);
        
        finalPath = zipResult.zipPath;

        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
      } else {
        // Move files from temp to output
        const finalDir = path.join(options.output, playlist.name);
        fs.mkdirSync(finalDir, { recursive: true });
        
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
          fs.renameSync(
            path.join(tempDir, file),
            path.join(finalDir, file)
          );
        }
        
        fs.rmdirSync(tempDir);
        finalPath = finalDir;
      }

      // Final summary
      console.log('\n✨ Download complete!');
      console.log(`📁 Location: ${finalPath}`);
      console.log(`✅ Success: ${successfulDownloads.length} songs`);
      if (failedDownloads.length > 0) {
        console.log(`❌ Failed: ${failedDownloads.length} songs`);
      }

    } catch (error) {
      spinner.fail('Download failed');
      logger.error(error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    } finally {
      logger.clearSpinner();
    }
  });

program.parse();
