const lines = (output: string) => output.split('\n').map((line) => line.trim()).filter(Boolean);
const codexSlugs = (output: string) => (JSON.parse(output).models as { slug: string }[]).map((model) => model.slug);
const piIds = (output: string) => lines(output).slice(1).map((line) => line.split(/\s+/)).map(([provider, model]) => provider + '/' + model);
const firstColumn = (output: string) => lines(output).map((line) => line.split('\t')).filter((columns) => columns.length > 1).map(([id]) => id);

export const modelListings: Record<string, { args: string[]; parse: (output: string) => string[] }> = {
  opencode: { args: ['models'], parse: lines },
  pi: { args: ['--list-models'], parse: piIds },
  codex: { args: ['debug', 'models'], parse: codexSlugs },
  agy: { args: ['models'], parse: firstColumn },
};
const validModel = /^[A-Za-z0-9_/.:+-]{1,120}$/;

export function parseModelListing(kind: string, output: string): string[] {
  const listing = modelListings[kind];
  if (!listing) return [];
  try { return [...new Set(listing.parse(output).filter((id) => validModel.test(id)))]; } catch { return []; }
}
