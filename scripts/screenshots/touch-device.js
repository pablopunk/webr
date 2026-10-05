const touchQuery = /\(\s*(pointer:\s*coarse|hover:\s*none)\s*\)/;
const realMatchMedia = window.matchMedia.bind(window);
window.matchMedia = (query) => {
  const media = realMatchMedia(query);
  if (!touchQuery.test(query)) return media;
  return new Proxy(media, { get: (target, key) => key === 'matches' ? true : typeof target[key] === 'function' ? target[key].bind(target) : target[key] });
};
