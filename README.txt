THE CROSS ROOM  (MVP)
=====================

HOW TO RUN
  Unzip, then double-click index.html. No server, no internet, no install.
  (Works in Chrome / Edge / Firefox / Safari, desktop and phone.)
  Progress is saved in your browser (localStorage). Same browser = same save.

FILES
  index.html  page structure
  style.css   UI look
  art.js      pixel renderer (320x180 canvas, dithered lighting, character, Shadow, nails)
  audio.js    synthesized sound (drone, heartbeat, thud, release chime)
  game.js     rules, interrogation, goals, nails, death, ritual, 7-day tracker

HOW IT PLAYS
  GOALS         add 1-3 real commitments (max 5). Tick one off -> a nail comes out.
  FACE A DECISION  4 questions (what / why / cost / smallest honest step) -> verdict ->
                a timed step. Report DONE / PARTLY / NOT DONE honestly.
  Hidden meter  avoidance (overdue goals, "avoidance" verdicts, not-done steps) raises it.
                You never see it. Nails, glitches, whispers, heartbeat show it.
                Past a hidden limit (random 9-12 per run) the character dies (fiction),
                then ritual -> new run. Real history is kept.
  THE VOW       after a character death the ritual starts YOUR vow: 7 days Tahajjud +
                20 rak'at nafl daily (= 140 rak'at). Tick each day in SEVEN DAYS.
                Miss a day -> restarts from day 1. A "night" ends at 6:00 AM, so a 3 AM
                Tahajjud counts for that night. Change rak'at or switch off in SETTINGS.
  SETTINGS      sound, reduced flashing, horror intensity, quick mode, your likeness
                (skin / hair / beard), erase data.

TWEAK LATER
  Nail thresholds & fatal range ........ game.js  (THRESH, fatalAt: rint(9,12))
  Overdue penalty spacing .............. game.js  checkOverdue() (20 min)
  Colours / scene ...................... art.js
  Texts of questions ................... game.js  STEPS
