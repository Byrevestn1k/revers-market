/** Return the local thumbnail endpoint when a stored listing photo supports it. */
export const photoThumbnailUrl = (url: string): string =>
    /^\/uploads\/(products|buy-requests)\/[0-9a-f-]{36}(?:\/[0-9a-f-]{36})?\/\d+\.(jpg|png|webp|gif)$/i.test(url)
        ? '/api/photo-thumbnail?path=' + encodeURIComponent(url)
        : url
