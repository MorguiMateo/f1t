/** A session write changes the 28-day activity estimate for any affected date. */
export const energySessionKeys = {
  all: ["energy", "sessions"] as const,
  onDate: (date: string) => [...energySessionKeys.all, date] as const,
};
