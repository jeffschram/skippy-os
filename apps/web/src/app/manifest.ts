import type { MetadataRoute } from "next";

/** What a phone or a desktop needs to install Skippy OS as an app. On an iPhone, notifications only work once it is installed. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Skippy OS",
    short_name: "Skippy",
    description: "Projects, tasks and what is worth remembering, in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#15171a",
    theme_color: "#15171a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
