import fs from 'fs';
import path from 'path';
import https from 'https';
import { spawnSync } from 'child_process';
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
        hostname: 'www.youtube.com',
        path: '/',
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      },
      (res) => {
        res.resume();
        // Any HTTP response means the connection is up
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

function getProcessErrorOutput(stdout?: string, stderr?: string): string {
  return [stdout, stderr].filter((part) => part && part.trim().length > 0).join('\n').trim();
}

function isInterrupted(message: string, signal?: string | null): boolean {
  return signal === 'SIGINT' || /Interrupted by user/i.test(message) || signal === 'SIGTERM';
}

class DownloadCancelledError extends Error {
  constructor() {
    super('Download cancelled');
    this.name = 'DownloadCancelledError';
  }
}

class DownloadSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadSetupError';
  }
}

function isBrowserCookieAccessError(message: string): boolean {
  return /Could not copy Chrome cookie database/i.test(message) || /cookies-from-browser/i.test(message) && /cookie database/i.test(message);
}

export interface DownloadOptions {
  outputDir: string;
  concurrency?: number;
  quality?: string;
  cookiesFile?: string;
  cookiesFromBrowser?: string;
  onProgress?: (progress: DownloadProgress) => void;
  isCancelled?: () => boolean;
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
  cookiesFromBrowser?: string,
  onProgress?: (progress: DownloadProgress) => void,
  isCancelled?: () => boolean
): Promise<DownloadResult> {
  const sanitizedTitle = sanitizeFilename(`${song.artist} - ${song.title}`);
  const outputBasePath = path.join(outputDir, sanitizedTitle);
  const outputPath = `${outputBasePath}.mp3`;
  const maxRetries = 4;

  try {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (isCancelled?.()) {
        throw new DownloadCancelledError();
      }

      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }

      // Update progress: downloading
      onProgress?.({
        songId: song.id,
        title: song.title,
        status: 'downloading',
        progress: 0,
      });

      // Construct yt-dlp command
      const ytDlpArgs = [
        '-m',
        'yt_dlp',
        '-f',
        'bestaudio/best',
        '--extract-audio',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '0',
        ...(cookiesFile ? ['--cookies', cookiesFile] : []),
        ...(cookiesFromBrowser ? ['--cookies-from-browser', cookiesFromBrowser] : []),
        `https://www.youtube.com/watch?v=${song.id}`,
        '-o',
        `${outputBasePath}.%(ext)s`,
        '--no-warnings',
      ];

      const result = spawnSync('py', ytDlpArgs, {
        encoding: 'utf-8',
        maxBuffer: 100 * 1024 * 1024,
      });

      if (result.status === 0) {
        break; // success; exit retry loop
      }

      const processOutput = getProcessErrorOutput(result.stdout ?? '', result.stderr ?? '');
      const message = processOutput || result.error?.message || 'Unknown error';

      if (isInterrupted(message, result.signal)) {
        throw new DownloadCancelledError();
      }

      if (isNetworkError(message) && attempt < maxRetries) {
        const prefix = `(${attempt}/${maxRetries}) `;
        console.log(`${prefix}Network issue detected. Pausing until internet returns...`);
        await waitForReconnect(prefix);
        continue; // retry
      }

      throw new Error(message);
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Expected MP3 output was not created: ${outputPath}`);
    }

    onProgress?.({
      songId: song.id,
      title: song.title,
      status: 'converting',
      progress: 50,
    });

    onProgress?.({
      songId: song.id,
      title: song.title,
      status: 'completed',
      progress: 100,
    });

    return {
      song,
      filePath: outputPath,
      success: true,
    };
  } catch (error) {
    if (error instanceof DownloadCancelledError) {
      throw error;
    }

    if (error instanceof DownloadSetupError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (isBrowserCookieAccessError(errorMessage)) {
      throw new DownloadSetupError(
        'Could not read browser cookies. Close Chrome completely (including background processes) and retry, or use --cookies <cookies.txt>.'
      );
    }

    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    
    onProgress?.({
      songId: song.id,
      title: song.title,
      status: 'failed',
      progress: 0,
      error: errorMessage,
    });

    if (!onProgress) {
      logger.error(`Failed to download "${song.title}": ${errorMessage}`);
    }

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
  const { outputDir, concurrency = 5, cookiesFile, cookiesFromBrowser, onProgress, isCancelled } = options;

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
      if (isCancelled?.()) {
        throw new DownloadCancelledError();
      }

      const result = await downloadSong(song, outputDir, cookiesFile, cookiesFromBrowser, onProgress, isCancelled);
      results.push(result);
      return result;
    })
  );

  // Wait for all downloads to complete
  try {
    await Promise.all(downloadPromises);
  } catch (error) {
    queue.clear();
    if (error instanceof DownloadCancelledError) {
      throw error;
    }
    if (error instanceof DownloadSetupError) {
      throw error;
    }
    throw error;
  }

  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  logger.success(`Downloads complete: ${successCount} successful, ${failedCount} failed`);

  return results;
}
