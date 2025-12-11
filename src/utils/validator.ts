//  Validates if the given string is a valid YouTube video URL.
export function isValidYouTubeUrl(url: string): boolean {
    const youtubePatterns = [
            /(?:https?:)?\/\/(?:www\.)?youtube\.com\/playlist\?list=/i,
            /(?:https?:)?\/\/(?:www\.)?youtube\.com\/watch\?v=/i,
            /(?:https?:)?\/\/music\.youtube\.com\/playlist\?list=/i,
            /(?:https?:)?\/\/music\.youtube\.com\/browse\//i,
            /(?:https?:)?\/\/youtu\.be\//i,
    ];

    return youtubePatterns.some(pattern => pattern.test(url));
}


// Extracts playslist ID from a valid YouTube playlist URL.
export function extractPlaylistId(url: string): string | null {
    const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    return match?.[1] ?? null;
}


// Extracts video ID from a valid YouTube video URL.
export function extractVideoId(url: string): string | null {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/.*[?&]v=|youtu\.be\/)([^&\n?#]+)/);
    return match?.[1] ?? null;
}

// Validates if the given string is a valid file name (no illegal characters).
export function sanitizeFilename(fileName: string): string {
    return fileName
        .replace(/[\/\\?%*:|"<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
}

