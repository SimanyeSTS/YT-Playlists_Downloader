import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { logger } from '../../utils/logger.js';
import { sanitizeFilename } from '../../utils/validator.js';

export interface ZipOptions {
  sourceDir: string;
  outputDir: string;
  zipName: string;
}

export interface ZipResult {
  zipPath: string;
  totalSize: number;
  fileCount: number;
}

/**
 * Creates a ZIP archive from a directory
 */
export async function createZip(options: ZipOptions): Promise<ZipResult> {
  const { sourceDir, outputDir, zipName } = options;
  
  const sanitizedName = sanitizeFilename(zipName);
  const zipPath = path.join(outputDir, `${sanitizedName}.zip`);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }, // Maximum compression
    });

    let fileCount = 0;
    let totalSize = 0;

    output.on('close', () => {
      totalSize = archive.pointer();
      const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      logger.success(`ZIP created: ${zipPath} (${sizeMB} MB, ${fileCount} files)`);
      
      resolve({
        zipPath,
        totalSize,
        fileCount,
      });
    });

    archive.on('error', (err: Error) => {
      logger.error(`ZIP creation failed: ${err.message}`);
      reject(err);
    });

    archive.on('entry', () => {
      fileCount++;
    });

    archive.pipe(output);

    // Add all files from source directory
    archive.directory(sourceDir, false);

    archive.finalize();
  });
}

/**
 * Gets the total size of files in a directory
 */
export function getDirectorySize(dirPath: string): number {
  let totalSize = 0;

  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  const files = fs.readdirSync(dirPath);
  
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isFile()) {
      totalSize += stats.size;
    }
  }

  return totalSize;
}
