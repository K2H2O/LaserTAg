/** @type {import('next').NextConfig} */
import type { Configuration } from 'webpack';

const nextConfig = {
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'],
  
  webpack: (config: Configuration) => {
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      fs: false,
      path: false,
      crypto: false,
    };
    return config;
  },
  
};

module.exports = nextConfig;