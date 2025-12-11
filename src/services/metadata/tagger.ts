import fs from 'fs';
import https from 'https';
import NodeID3 from 'node-id3';
import type { Song } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Downloads cover art from URL
 */
async function downloadCoverArt(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    https
      .get(url, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', () => resolve(null));
      })
      .on('error', () => resolve(null));
  });
}

/**
 * Adds ID3 metadata tags to an MP3 file
 */
export async function addMetadata(filePath: string, song: Song): Promise<boolean> {
  try {
    const tags: NodeID3.Tags = {
      title: song.title,
      artist: song.artist,
    };

    // Download and attach cover art if available
    if (song.coverUrl) {
      const coverBuffer = await downloadCoverArt(song.coverUrl);
      if (coverBuffer) {
        tags.image = {
          mime: 'image/jpeg',
          type: {
            id: 3,
            name: 'front cover',
          },
          description: 'Cover',
          imageBuffer: coverBuffer,
        };
      }
    }

    // Write tags to file
    const success = NodeID3.write(tags, filePath);
    
    if (!success) {
      logger.warn(`Failed to write metadata for: ${song.title}`);
      return false;
    }

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Error adding metadata to "${song.title}": ${errorMessage}`);
    return false;
  }
}

/**
 * Adds metadata to multiple files
 */
export async function addMetadataToFiles(
  files: Array<{ filePath: string; song: Song }>
): Promise<void> {
  logger.info(`Adding metadata to ${files.length} files...`);

  for (const { filePath, song } of files) {
    if (fs.existsSync(filePath)) {
      await addMetadata(filePath, song);
    }
  }

  logger.success('Metadata addition complete');
}
