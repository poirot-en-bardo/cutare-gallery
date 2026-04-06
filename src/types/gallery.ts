export interface Artist {
  id: string;
  name: string;
  photoUrl: string;
  bio: string;
  contact: string;
  instagram?: string;
}

export interface ArtworkRecord {
  id: string;
  title: string;
  artistId: string;
  imageUrl: string;
  roomId: string;
  year?: string;
  description?: string;
  price?: string;
  sold?: boolean;
  forSale?: boolean;
}

export interface Artwork extends Omit<ArtworkRecord, 'artistId'> {
  artist: Artist;
}
