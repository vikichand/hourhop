// Single source of product identity. Every surface and the manifest read from here. [T-105]
// "HourHop for Karbon" stays provisional until trademark/store clearance; do not render it.
export const APP = {
  brand: 'HourHop',
  extensionName: 'HourHop',
  internalName: 'HourHop - Karbon',
  provisionalPublicTitle: 'HourHop for Karbon',
  tagline: 'Switch work. Track time.',
  description: 'Switch work. Track time. Local-first time capture for client work. Not affiliated with or endorsed by Karbon.',
  version: '0.1.0',
  nonAffiliation: 'HourHop is an independent tool. It is not affiliated with, endorsed by or connected to Karbon.',
} as const;
