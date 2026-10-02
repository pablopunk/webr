type Version = { core: number[]; prerelease: boolean };

const parse = (text: string): Version | undefined => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(-[^+]+)?/.exec(text.trim());
  return match ? { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: !!match[4] } : undefined;
};

export function isNewerVersion(candidate: string, current: string) {
  const next = parse(candidate);
  const installed = parse(current);
  if (!next || !installed) return false;
  const differing = next.core.findIndex((part, index) => part !== installed.core[index]);
  if (differing >= 0) return next.core[differing] > installed.core[differing];
  return installed.prerelease && !next.prerelease;
}
