// Single source of product identity. Every surface and the manifest read from here. [T-105]
// Karbon is named only to state compatibility and non-affiliation, never as part of the brand.
export const APP = {
  brand: 'HourHop',
  extensionName: 'HourHop',
  tagline: 'Switch work. Track time.',
  description: 'Switch work. Track time. One-click time tracking for your Karbon work, read-only. Not affiliated with or endorsed by Karbon.',
  version: '0.4.0',
  nonAffiliation: 'HourHop is an independent tool. It is not affiliated with, endorsed by or connected to Karbon.',
} as const;
