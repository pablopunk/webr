const homePrefix = /^\/(?:Users|home)\/[^/]+/;

export const withTildeHome = (path: string) => path.replace(homePrefix, '~');
