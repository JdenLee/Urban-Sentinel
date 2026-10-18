import type { JoinedFeature } from '../types/predictions';

export interface Landmark {
  bin: string;
  name: string;
  address: string;
  aliases: string[];
  source: string;
  model?: 'one-wtc';
  architecturalHeight?: number;
  completed?: number;
  /** Wikimedia Commons file shown as the building's photo, credited from Commons at runtime. */
  photo?: string;
}

/** Presentation metadata keyed to verified NYC footprint BINs; never supplies a score. */
export const LANDMARKS: readonly Landmark[] = [
  { bin: '1088469', name: 'One World Trade Center', address: '1 World Trade Center', aliases: ['World Trade Center', 'Freedom Tower', 'One WTC', '1 WTC'], source: 'https://www.som.com/projects/one-world-trade-center/', model: 'one-wtc', architecturalHeight: 541.3, completed: 2014, photo: 'File:One World Trade Center 2023.jpg' },
  { bin: '1086510', name: '7 World Trade Center', address: '250 Greenwich Street', aliases: ['Seven World Trade Center', '7 WTC'], source: 'https://www.som.com/projects/7-world-trade-center/', photo: 'File:7 World Trade Center from 3WTC (cropped).jpg' },
  { bin: '1087167', name: 'Woolworth Building', address: '233 Broadway', aliases: ['Woolworth'], source: 'https://woolworthbuilding.com/', photo: 'File:Woolworth Building in fall.jpg' },
  { bin: '1079147', name: 'New York City Hall', address: 'City Hall Park', aliases: ['City Hall'], source: 'https://www.nyc.gov/site/dcas/business/dcasmanagedbuildings/city-hall.page', photo: 'File:New York City Hall exterior, October 2016.jpg' },
  { bin: '1001018', name: 'The Trump Building', address: '40 Wall Street', aliases: ['40 Wall Street', 'Bank of Manhattan'], source: 'https://40wallstreet.com/', photo: 'File:40 Wall Street.jpg' },
  { bin: '1001007', name: '70 Pine Street', address: '70 Pine Street', aliases: ['Cities Service Building', 'American International Building'], source: 'https://70pine.com/', photo: 'File:American International Building3 (cropped).JPG' },
  { bin: '1087485', name: '8 Spruce · New York by Gehry', address: '8 Spruce Street', aliases: ['8 Spruce', 'New York by Gehry', 'Beekman Tower'], source: 'https://www.8sprucestreet.com/', photo: 'File:8 Spruce Street 2015.jpg' },
];

const byBin = new Map(LANDMARKS.map((landmark) => [landmark.bin, landmark]));
export const landmarkFor = (bin: string) => byBin.get(bin);
export const buildingName = (bin: string, address?: string | null) => landmarkFor(bin)?.name ?? address ?? `BIN ${bin}`;
export const displayHeight = (f: JoinedFeature) => landmarkFor(f.properties.bin)?.architecturalHeight ?? f.properties.height_m;

export function searchLandmarks(features: JoinedFeature[], query: string): JoinedFeature[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return features.filter((feature) => {
    const landmark = landmarkFor(feature.properties.bin);
    return landmark && [landmark.name, landmark.address, ...landmark.aliases].some((s) => s.toLowerCase().includes(q));
  }).sort((a, b) => LANDMARKS.findIndex((l) => l.bin === a.properties.bin) - LANDMARKS.findIndex((l) => l.bin === b.properties.bin));
}
