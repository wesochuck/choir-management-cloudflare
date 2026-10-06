# Digital scores in the music library

Music pieces support uploaded PDF sheet music (Digital Scores) stored in private files and made
accessible to active Organization Members when a piece appears on an approved Set List for an event
they are attending. To protect copyright and comply with sheet music licensing, scores are never
exposed through unauthenticated Practice Player links or open catalog browsing.

Each Music Piece maintains a Primary Score (typically a Choral Octavo or Vocal Score) provided to
all attending singers, alongside optional Supplementary Scores mapped either to specific Voice Parts
(e.g., Tenor 1, Alto) or standard edition roles (e.g., Full Score, Accompaniment). Movements within
a Multi-Work Piece without a movement-specific upload inherit the parent work's Primary Score as a
transparent fallback, avoiding redundant file uploads for multi-movement choral works. Rehearsals
linked to an approved Performance inherit that Performance's set list, so attending singers can
prepare from the same scores they will use at the concert.

Scores are strictly validated as `application/pdf` up to 20 MB and served directly via authenticated
endpoints for in-browser reading or export to tablet reader applications (such as ForScore and
MobileSheets). In addition to individual score links across event Set Lists on the Member Dashboard,
My Schedule, and Repertoire views, an Event Score Bundle endpoint provides a one-click ZIP download
of all scores matching the member's part for that event. Score filenames follow the safe learning
track naming convention (`[Piece Title] - [Edition or Part].pdf`, prefixed with parent titles for
movements, e.g., `Fauré Requiem - 4. Pie Jesu - Choral Score.pdf`), ensuring clean, unambiguous
tablet imports.
