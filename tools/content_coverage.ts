/** Reproducible interpreter coverage audit over all recovered plaintext lessons. */
import { lessonFrames, type Lesson } from "../web/src/replay";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const data = (await Bun.file(
  `${root}/web/public/content/lessons.json`,
).json()) as { lessons: Lesson[] };
const report = data.lessons.map((lesson) => {
  const frames = lessonFrames(lesson);
  return {
    id: lesson.id,
    steps: lesson.steps.length,
    frames: frames.length,
    exercises: frames.filter((f) => f.exercise).length,
    warnings: [...new Set(frames.flatMap((f) => f.warnings))],
  };
});
await Bun.write(
  `${root}/recovery/content/coverage.json`,
  JSON.stringify({ schemaVersion: 1, lessons: report }, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      lessons: report.length,
      frames: report.reduce((n, l) => n + l.frames, 0),
      lessonsWithWarnings: report.filter((l) => l.warnings.length).length,
      uniqueWarnings: [...new Set(report.flatMap((l) => l.warnings))],
    },
    null,
    2,
  ),
);
