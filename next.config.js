/** @type {import("next").NextConfig} */
const config = {
  output: "export",
  outputFileTracingRoot: import.meta.dirname,
  images: {
    unoptimized: true,
  },
};

export default config;
