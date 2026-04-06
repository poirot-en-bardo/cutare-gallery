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

const metadataModules = import.meta.glob('../data/exhibitions/*/*/metadata.json', {
  eager: true,
});
const artworksModules = import.meta.glob('../data/exhibitions/*/*/artworks.json', {
  eager: true,
});
const posterModules = import.meta.glob('../data/exhibitions/*/*/*.{png,jpg,jpeg,webp,avif,svg}', {
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

function statusPriority(status: ExhibitionStatus): number {
  if (status === 'current') return 3;
  if (status === 'upcoming') return 2;
  return 1;
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
  const raw = Object.entries(metadataModules).map(([file, mod]) => {
    const segments = file.split('/');
    const folderStatus = segments[segments.length - 3] as ExhibitionStatus;
    const folderId = segments[segments.length - 2];
    const data = parseMetadata(mod);
    const thumbnailPath = `../data/exhibitions/${folderStatus}/${folderId}/${data.thumbnail}`;
    const thumbnail = data.thumbnail.startsWith('/')
      ? data.thumbnail
      : posterModules[thumbnailPath] || data.thumbnail;
    const status = deriveStatusFromDates(data.startDate, data.endDate);
    return {
      ...data,
      folderId,
      thumbnail,
      status,
      folderStatus,
      metadataId: data.id,
    };
  });

  const metadataIdCounts = new Map<string, number>();
  raw.forEach((entry) => {
    const metadataId = entry.metadataId?.trim();
    if (!metadataId) return;
    metadataIdCounts.set(metadataId, (metadataIdCounts.get(metadataId) ?? 0) + 1);
  });

  const candidates = raw.map((entry) => {
    const metadataId = entry.metadataId?.trim();
    const isUniqueMetadataId = Boolean(metadataId) && metadataIdCounts.get(metadataId!) === 1;
    const id = isUniqueMetadataId ? metadataId! : entry.folderId;
    return {
      ...entry,
      id,
    };
  });

  const byId = new Map<string, (Exhibition & { folderStatus: ExhibitionStatus })>();
  candidates.forEach((candidate) => {
    const existing = byId.get(candidate.id);
    if (!existing) {
      byId.set(candidate.id, candidate);
      return;
    }

    const candidateMatchesStatus = candidate.folderStatus === candidate.status;
    const existingMatchesStatus = existing.folderStatus === existing.status;
    if (candidateMatchesStatus !== existingMatchesStatus) {
      if (candidateMatchesStatus) byId.set(candidate.id, candidate);
      return;
    }

    const candidatePriority = statusPriority(candidate.status);
    const existingPriority = statusPriority(existing.status);
    if (candidatePriority !== existingPriority) {
      if (candidatePriority > existingPriority) {
        byId.set(candidate.id, candidate);
      }
      return;
    }

    if (candidate.startDate > existing.startDate) {
      byId.set(candidate.id, candidate);
    }
  });

  return Array.from(byId.values()).map(
    ({ folderStatus: _folderStatus, metadataId: _metadataId, ...exhibition }) => exhibition
  );
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
