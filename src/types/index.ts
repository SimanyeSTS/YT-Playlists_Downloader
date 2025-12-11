// Song metadata structure
export interface Song {
    id: string;
    title: string;
    artist: string;
    duration: number;
    coverUrl?: string;
    downloadUrl?: string;
}

// Playslist structure
export interface Playlist {
    name: string;
    songs: Song[];
    totalCount: number;
}

// Download progress tracking
export interface DownloadProgress {
    songId: string;
    title: string;
    status: 'pending' | 'downloading' | 'converting' | 'completed' | 'failed';
    progress: number;
    error?: string;
}

// Final download result
export interface DownloadResult {
    playlistName: string;
    zipPath: string;
    successCount: number;
    failedCount: number;
    totalSize: number; // in MB
}