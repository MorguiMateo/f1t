import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.morguimateo.f1t",
  appName: "F1t",
  webDir: "dist",
  ios: {
    // CSS already accounts for env(safe-area-inset-*); avoid a second native inset.
    contentInset: "never",
    scrollEnabled: true,
  },
};

export default config;
