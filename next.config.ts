import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: {
    appIsrStatus: false,  // Disable the ISR indicator
    buildActivity: false, // Disable the build activity indicator
    buildActivityPosition: 'bottom-right',
  },
};

export default nextConfig;
