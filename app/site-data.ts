export const PROJECT_X_URL = "https://x.com/BunnysHood";

export const nfts = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  name: `Bunny Hood #${String(index + 1).padStart(2, "0")}`,
  image: `/assets/nfts/bunny-${String(index + 1).padStart(2, "0")}.webp`,
  // Add a transparent character PNG here when final art is ready.
  character: null as string | null,
}));
