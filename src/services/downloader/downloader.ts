import fs from 'fs';
import path from 'path';
import https from 'https';
import { execSync } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import PQueue from 'p-queue';
import { logger } from '../../utils/logger.js';
import { sanitizeFilename } from '../../utils/validator.js';
import type { Song, DownloadProgress } from '../../types/index.js';

const NETWORK_ERROR_PATTERNS = [
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /network is unreachable/i,
  /getaddrinfo ENOTFOUND/i,
  /Temporary failure in name resolution/i,
  /Resolving timed out/i,
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function isOnline(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: 'clients3.google.com',
        path: '/generate_204',
        timeout: 3000,
      },
      (res) => {
        res.resume();
        resolve(true);
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

async function waitForReconnect(logPrefix: string): Promise<void> {
  let announced = false;
  while (true) {
    const online = await isOnline();
    if (online) {
      if (announced) {
        console.log(`${logPrefix}🌐 Internet reconnected. Resuming downloads...`);
      }
      return;
    }

    if (!announced) {
      console.log(`${logPrefix}🌐 No internet. Pausing downloads until connection is back...`);
      announced = true;
    } else {
      console.log(`${logPrefix}🌐 Still offline. Retrying in 5s...`);
    }
    await delay(5000);
  }
}

function isNetworkError(message: string): boolean {
  return NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

// Set FFmpeg path
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

export interface DownloadOptions {
  outputDir: string;
  concurrency?: number;
  quality?: string;
  cookiesFile?: string;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface DownloadResult {
  song: Song;
  filePath: string;
  success: boolean;
  error?: string;
}

/**
 * Downloads a single song with highest quality audio using yt-dlp
 */
async function downloadSong(
  song: Song,
  outputDir: string,
  cookiesFile?: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult> {
  const sanitizedTitle = sanitizeFilename(`${song.artist} - ${song.title}`);
  const outputPath = path.join(outputDir, `${sanitizedTitle}.mp3`);
  const tempAudioPath = path.join(outputDir, `${sanitizedTitle}.webm`);
  const maxRetries = 4;

  try {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Ensure connectivity before attempting
      await waitForReconnect('');

      // Update progress: downloading
      onProgress?.({
        songId: song.id,
        title: song.title,
        status: 'downloading',
        progress: 0,
      });

      // Construct yt-dlp command
      const cookiesArg = cookiesFile ? `--cookies "${cookiesFile}"` : '';
      const command = `py -m yt_dlp -f "bestaudio[ext=webm]/bestaudio" ${cookiesArg} "https://www.youtube.com/watch?v=${song.id}" -o "${tempAudioPath}" --no-warnings`;

      try {
        execSync(command, {
          stdio: 'ignore',
          maxBuffer: 100 * 1024 * 1024,
        });
        break; // success; exit retry loop
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';

        // Clean up temp file if created
        if (fs.existsSync(tempAudioPath)) {
          fs.unlinkSync(tempAudioPath);
        }

        if (isNetworkError(message) && attempt < maxRetries) {
          const prefix = `(${attempt}/${maxRetries}) `;
          console.log(`${prefix}Network issue detected. Pausing until internet returns...`);
          await waitForReconnect(prefix);
          continue; // retry
        }

        throw error;
      }
    }

    // Convert to MP3 with FFmpeg
    await new Promise<void>((resolve, reject) => {
      onProgress?.({
        songId: song.id,
        title: song.title,
        status: 'converting',
        progress: 50,
      });

      ffmpeg(tempAudioPath)
        .audioBitrate(320)
        .audioCodec('libmp3lame')
        .format('mp3')
        .on('end', () => {
          // Clean up temp file
          if (fs.existsSync(tempAudioPath)) {
            fs.unlinkSync(tempAudioPath);
          }
          
          onProgress?.({
            songId: song.id,
            title: song.title,
            status: 'completed',
            progress: 100,
          });
          resolve();
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .save(outputPath);
    });

    return {
      song,
      filePath: outputPath,
      success: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Clean up temp file if it exists
    if (fs.existsSync(tempAudioPath)) {
      fs.unlinkSync(tempAudioPath);
    }
    
    onProgress?.({
      songId: song.id,
      title: song.title,
      status: 'failed',
      progress: 0,
      error: errorMessage,
    });

    logger.error(`Failed to download "${song.title}": ${errorMessage}`);

    return {
      song,
      filePath: '',
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Downloads multiple songs with concurrency control
 */
export async function downloadSongs(
  songs: Song[],
  options: DownloadOptions
): Promise<DownloadResult[]> {
  const { outputDir, concurrency = 5, cookiesFile, onProgress } = options;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Create queue with concurrency limit
  const queue = new PQueue({ concurrency });
  const results: DownloadResult[] = [];

  logger.info(`Starting download of ${songs.length} songs with concurrency: ${concurrency}`);

  // Queue all downloads
  const downloadPromises = songs.map((song) =>
    queue.add(async () => {
      const result = await downloadSong(song, outputDir, cookiesFile, onProgress);
      results.push(result);
      return result;
    })
  );

  // Wait for all downloads to complete
  await Promise.all(downloadPromises);

  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  logger.success(`Downloads complete: ${successCount} successful, ${failedCount} failed`);

  return results;
}
