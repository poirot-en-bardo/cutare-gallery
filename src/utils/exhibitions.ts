import { getArtistById } from './artists';
import type { Artwork, ArtworkRecord } from '../types/gallery';

export type ExhibitionStatus = 'current' | 'past' | 'upcoming';

export interface ExhibitionMetadata {
  id: string;
  title: string;
  description: string;
  location: string;
  locationMapUrl: string;
  startDate: string;
  endDate: string;
  thumbnail: string;
}

export interface Exhibition extends ExhibitionMetadata {
  folderId: string;
  status: ExhibitionStatus;
}

const metadataModules = import.meta.glob('../data/exhibitions/*/metadata.json', {
  eager: true,
});
const artworksModules = import.meta.glob('../data/exhibitions/*/artworks.json', {
  eager: true,
});
const posterModules = import.meta.glob('../data/exhibitions/*/*.{png,jpg,jpeg,webp,avif,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
let integrityChecked = false;
const warnedIssues = new Set<string>();

function handleDataIssue(message: string): void {
  if (import.meta.env.DEV) {
    throw new Error(message);
  }
  console.warn(message);
}

function handleDataIssueOnce(message: string): void {
  if (import.meta.env.DEV) {
    throw new Error(message);
  }
  if (warnedIssues.has(message)) return;
  warnedIssues.add(message);
  console.warn(message);
}

function getTodayLocalIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function deriveStatusFromDates(startDate: string, endDate: string): ExhibitionStatus {
  const today = getTodayLocalIsoDate();
  if (today < startDate) return 'upcoming';
  if (today > endDate) return 'past';
  return 'current';
}

function parseMetadata(module: unknown): ExhibitionMetadata {
  const data = (module as { default?: ExhibitionMetadata }).default ?? (module as ExhibitionMetadata);
  return data;
}

function getArtworkRecordsFromModule(module: unknown): ArtworkRecord[] {
  const value = (module as { default?: ArtworkRecord[] }).default ?? (module as ArtworkRecord[]);
  return Array.isArray(value) ? value : [];
}

function getRoomsFromArtworkRecords(artworkRecords: ArtworkRecord[]): Array<{ id: string; name: string }> {
  const roomIds = Array.from(
    new Set(
      artworkRecords
        .map((artwork) => String(artwork.roomId ?? '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => {
    const aNumber = Number.parseInt(a, 10);
    const bNumber = Number.parseInt(b, 10);
    const aIsNumber = Number.isFinite(aNumber);
    const bIsNumber = Number.isFinite(bNumber);
    if (aIsNumber && bIsNumber) return aNumber - bNumber;
    if (aIsNumber) return -1;
    if (bIsNumber) return 1;
    return a.localeCompare(b, 'ro', { numeric: true, sensitivity: 'base' });
  });

  return roomIds.map((roomId) => ({
    id: roomId,
    name: `Sala ${roomId}`,
  }));
}

function validateDataIntegrityOnce(): void {
  if (integrityChecked) return;
  integrityChecked = true;

  const issues: string[] = [];
  Object.entries(artworksModules).forEach(([file, module]) => {
    const folderId = file.split('/').at(-2) ?? 'unknown-exhibition';
    const records = getArtworkRecordsFromModule(module);
    records.forEach((record) => {
      if (!record.artistId) {
        issues.push(
          `[exhibitions] Missing artistId for artwork "${record.id}" in "${folderId}".`
        );
        return;
      }
      if (!getArtistById(record.artistId)) {
        issues.push(
          `[exhibitions] Missing artist "${record.artistId}" for artwork "${record.id}" in "${folderId}".`
        );
      }
    });
  });

  if (issues.length === 0) return;
  handleDataIssue(issues.join('\n'));
}

export function getAllExhibitions(): Exhibition[] {
  validateDataIntegrityOnce();
  return Object.entries(metadataModules).map(([file, mod]) => {
    const segments = file.split('/');
    const folderId = segments[segments.length - 2];
    const data = parseMetadata(mod);
    const thumbnailPath = `../data/exhibitions/${folderId}/${data.thumbnail}`;
    const thumbnail = data.thumbnail.startsWith('/')
      ? data.thumbnail
      : posterModules[thumbnailPath] || data.thumbnail;
    const status = deriveStatusFromDates(data.startDate, data.endDate);
    return {
      ...data,
      id: data.id?.trim() || folderId,
      folderId,
      thumbnail,
      status,
    };
  });
}

export function getExhibitionsByStatus(status: ExhibitionStatus): Exhibition[] {
  return getAllExhibitions()
    .filter((exhibition) => exhibition.status === status)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function getExhibitionById(id: string): Exhibition | undefined {
  return getAllExhibitions().find((exhibition) => exhibition.id === id);
}

export function getExhibitionContent(id: string): {
  rooms: Array<{ id: string; name: string }>;
  artworks: Artwork[];
} {
  const folderId = getAllExhibitions().find((exhibition) => exhibition.id === id)?.folderId ?? id;
  const artworksEntry = Object.entries(artworksModules).find(([file]) =>
    file.includes(`/${folderId}/artworks.json`)
  );
  const artworkRecords = artworksEntry
    ? getArtworkRecordsFromModule(artworksEntry[1])
    : [];
  const rooms = getRoomsFromArtworkRecords(artworkRecords);
  const artworks = artworkRecords.flatMap((artwork) => {
    const artist = getArtistById(artwork.artistId);
    if (!artist) {
      handleDataIssueOnce(
        `[exhibitions] Missing artist "${artwork.artistId}" for artwork "${artwork.id}" in "${id}".`
      );
      return [];
    }
    const { artistId: _artistId, ...rest } = artwork;
    return [{
      ...rest,
      artist,
    }];
  });

  return { rooms, artworks };
}
