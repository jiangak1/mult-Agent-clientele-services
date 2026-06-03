import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Customer Service Platform",
    short_name: "CSP",
    description: "Enterprise Multi-Agent Customer Service Platform",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0f",
    theme_color: "#6c8cff",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
