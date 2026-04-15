import fs from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';

const args = process.argv.slice(2);
const exhibitionId = args[0];

if (!exhibitionId || exhibitionId.startsWith('--')) {
  console.error('Usage: node scripts/parse-artist-xls.mjs <exhibition-id> [--input <dir>] [--dry-run]');
  process.exit(1);
}

let inputDir = path.join(process.cwd(), 'src/data/exhibition-imports', exhibitionId);
let dryRun = false;

for (let i = 1; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--input') {
    const next = args[i + 1];
    if (!next) {
      console.error('Missing value after --input');
      process.exit(1);
    }
    inputDir = path.resolve(next);
    i += 1;
    continue;
  }
  if (arg === '--dry-run') {
    dryRun = true;
    continue;
  }
  console.error(`Unknown argument: ${arg}`);
  process.exit(1);
}

const exhibitionsRoot = path.join(process.cwd(), 'src/data/exhibitions');
const artistsPath = path.join(process.cwd(), 'src/data/artists.json');

function normalizeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim();
}

function normalizeKey(value) {
  return normalizeCell(value).toLowerCase();
}

function normalizeSaleAvailability(value) {
  const text = normalizeCell(value).toLowerCase();
  if (!text) return undefined;
  if (['da', 'yes', 'true', '1', 'y'].includes(text)) return true;
  if (['nu', 'no', 'false', '0', 'n'].includes(text)) return false;
  return undefined;
}

function normalizeRoomId(value) {
  const text = normalizeCell(value).toLowerCase();
  if (!text) return undefined;
  const match = text.match(/(\d+)/);
  if (match?.[1]) return String(Number.parseInt(match[1], 10));
  return text;
}

function slugify(value) {
  return normalizeCell(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function pathExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findExhibitionFolder(id) {
  const directCandidate = path.join(exhibitionsRoot, id);
  if (await pathExists(directCandidate)) return directCandidate;

  const entries = await fs.readdir(exhibitionsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metadataPath = path.join(exhibitionsRoot, entry.name, 'metadata.json');
    if (!(await pathExists(metadataPath))) continue;
    const raw = await fs.readFile(metadataPath, 'utf8');
    const metadata = JSON.parse(raw);
    if (metadata?.id === id) return path.join(exhibitionsRoot, entry.name);
  }

  throw new Error(`Cannot find exhibition folder for "${id}" under ${exhibitionsRoot}`);
}

function parseWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}

function parseArtistRows(rows, sourceName) {
  const meta = {
    name: '',
    bio: '',
    contact: '',
    instagram: '',
  };

  const labelMap = new Map([
    ['nume artist', 'name'],
    ['scurta biografie', 'bio'],
    ['contact (email/telefon)', 'contact'],
    ['pagina instagram (dupa caz)', 'instagram'],
  ]);

  for (const row of rows) {
    const key = normalizeKey(row[0]);
    const target = labelMap.get(key);
    if (target) meta[target] = normalizeCell(row[1]);
  }

  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => normalizeKey(cell) === 'titlu lucrare')
  );

  if (headerIndex === -1) {
    throw new Error(`Missing artwork header row in ${sourceName}`);
  }

  const headerRow = rows[headerIndex].map((cell) => normalizeKey(cell));
  const titleIndex = headerRow.indexOf('titlu lucrare');
  const yearIndex = headerRow.indexOf('an');
  const descriptionIndex = headerRow.indexOf('descriere');
  const roomIndex = headerRow.indexOf('sala');
  const saleIndex = headerRow.indexOf('disponibila pentru vanzare (da/nu)');

  if (titleIndex === -1 || yearIndex === -1 || descriptionIndex === -1) {
    throw new Error(`Missing artwork columns in ${sourceName}`);
  }

  const artworks = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const title = normalizeCell(row[titleIndex]);
    const year = normalizeCell(row[yearIndex]);
    const description = normalizeCell(row[descriptionIndex]);
    const roomId = roomIndex >= 0 ? normalizeRoomId(row[roomIndex]) : undefined;
    const forSale = saleIndex >= 0 ? normalizeSaleAvailability(row[saleIndex]) : undefined;

    if (!title && !year && !description) continue;
    if (!title) {
      console.warn(`Skipping row ${i + 1} in ${sourceName}: missing title.`);
      continue;
    }

    artworks.push({
      title,
      year: year || undefined,
      description: description || undefined,
      roomId,
      forSale,
    });
  }

  return { meta, artworks };
}

function pickDefaultRoomId(existingArtworks) {
  const roomIds = existingArtworks
    .map((artwork) => normalizeRoomId(artwork.roomId))
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
  if (roomIds.length === 0) {
    return '1';
  }
  return String(Math.min(...roomIds));
}

function ensureUniqueId(base, existingIds) {
  let candidate = base;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  existingIds.add(candidate);
  return candidate;
}

const exhibitionFolder = await findExhibitionFolder(exhibitionId);
const exhibitionFolderId = path.basename(exhibitionFolder);
const artworksPath = path.join(exhibitionFolder, 'artworks.json');
const [artistsRaw, artworksRaw] = await Promise.all([
  fs.readFile(artistsPath, 'utf8'),
  fs.readFile(artworksPath, 'utf8').catch(() => '[]'),
]);

const artists = JSON.parse(artistsRaw);
const artworks = JSON.parse(artworksRaw);
const defaultRoomId = pickDefaultRoomId(artworks);

const existingArtistMap = new Map(artists.map((artist) => [artist.id, artist]));
const existingArtworkIds = new Set(artworks.map((artwork) => artwork.id));
const existingArtworkSignatures = new Set(
  artworks.map((artwork) => `${artwork.artistId}|${artwork.title}`.toLowerCase())
);

if (!(await pathExists(inputDir))) {
  console.error(`Input directory not found: ${inputDir}`);
  process.exit(1);
}

const files = (await fs.readdir(inputDir))
  .filter((name) => name.toLowerCase().endsWith('.xls') || name.toLowerCase().endsWith('.xlsx'))
  .map((name) => path.join(inputDir, name));

if (files.length === 0) {
  console.error(`No .xls or .xlsx files found in ${inputDir}`);
  process.exit(1);
}

let addedArtists = 0;
let updatedArtists = 0;
let addedArtworks = 0;
let skippedArtworks = 0;

for (const filePath of files) {
  const rows = parseWorkbook(filePath);
  const { meta, artworks: parsedArtworks } = parseArtistRows(rows, path.basename(filePath));

  if (!meta.name) {
    console.warn(`Skipping ${filePath}: missing "nume artist".`);
    continue;
  }

  const artistId = slugify(meta.name) || `artist-${Math.random().toString(36).slice(2, 8)}`;

  if (!existingArtistMap.has(artistId)) {
    const newArtist = {
      id: artistId,
      name: meta.name,
      photoUrl: '',
      bio: meta.bio || '',
      contact: meta.contact || '',
      instagram: meta.instagram || '',
    };
    artists.push(newArtist);
    existingArtistMap.set(artistId, newArtist);
    addedArtists += 1;
  } else {
    const existing = existingArtistMap.get(artistId);
    let touched = false;
    if (existing.name !== meta.name && meta.name) {
      console.warn(`Artist name mismatch for ${artistId}: keeping existing "${existing.name}".`);
    }
    if (!existing.bio && meta.bio) {
      existing.bio = meta.bio;
      touched = true;
    }
    if (!existing.contact && meta.contact) {
      existing.contact = meta.contact;
      touched = true;
    }
    if ((!existing.instagram || existing.instagram.trim() === '') && meta.instagram) {
      existing.instagram = meta.instagram;
      touched = true;
    }
    if (touched) updatedArtists += 1;
  }

  for (const artwork of parsedArtworks) {
    const signature = `${artistId}|${artwork.title}`.toLowerCase();
    if (existingArtworkSignatures.has(signature)) {
      skippedArtworks += 1;
      continue;
    }

    const titleSlug = slugify(artwork.title) || 'lucrare';
    const baseId = `${exhibitionFolderId}-${artistId}-${titleSlug}`;
    const id = ensureUniqueId(baseId, existingArtworkIds);

    const roomId = artwork.roomId || defaultRoomId;
    const forSale = artwork.forSale ?? true;
    const price = forSale ? 'Preț la cerere' : 'Indisponibil';

    artworks.push({
      id,
      title: artwork.title,
      artistId,
      imageUrl: '',
      roomId,
      year: artwork.year,
      description: artwork.description,
      forSale,
      sold: false,
      price,
    });

    existingArtworkSignatures.add(signature);
    addedArtworks += 1;
  }
}

if (!dryRun) {
  await fs.writeFile(artistsPath, `${JSON.stringify(artists, null, 2)}\n`, 'utf8');
  await fs.writeFile(artworksPath, `${JSON.stringify(artworks, null, 2)}\n`, 'utf8');
}

console.log(`Processed ${files.length} file(s).`);
console.log(`Added artists: ${addedArtists}, updated artists: ${updatedArtists}.`);
console.log(`Added artworks: ${addedArtworks}, skipped artworks: ${skippedArtworks}.`);
console.log(dryRun ? 'Dry run: no files were written.' : 'Done.');
