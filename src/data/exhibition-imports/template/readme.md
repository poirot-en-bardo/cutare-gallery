## How to use
1. Share the artist-submission-template.xls with the artists
2. Put filled files in:
   src/data/exhibition-imports/<exhibition-id>/
3. Run:
   `npm run parse:artist-xls -- <exhibition-id>`


## Notes

The parser appends to src/data/artists.json and the matching artworks.json inside src/data/exhibitions/*/<exhibition-id>/.

New artworks default the imageUrl/photoUrl to empty strings.

The `Etaj` column is ignored.

The `Sala` column should contain the final room number for the exhibition layout.
Examples accepted by the parser:
- `1`
- `Sala 1`
- `sala1`
