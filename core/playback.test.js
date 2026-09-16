import assert from "node:assert/strict";
import test from "node:test";

import { activeCueIndex, createPlaybackState, samplePlayback } from "./playback.js";

function sample(state, currentTime, duration = 60, paused = false) {
  return samplePlayback(state, { currentTime, duration, paused });
}

test("one-playthrough detector stops only after natural progress reaches the end and loops back", () => {
  let state = createPlaybackState();
  ({ state } = sample(state, 56.8));
  ({ state } = sample(state, 57.8));
  ({ state } = sample(state, 58.9));
  const result = sample(state, 0.15);

  assert.equal(result.completedOnePlaythrough, true);
  assert.equal(result.state.completedOnePlaythrough, true);
});

test("one-playthrough detector ignores a paused video sitting near its end", () => {
  let state = createPlaybackState();
  ({ state } = sample(state, 57.4, 60, true));
  ({ state } = sample(state, 59.6, 60, true));
  const result = sample(state, 0.1, 60, true);

  assert.equal(result.completedOnePlaythrough, false);
  assert.equal(result.state.completedOnePlaythrough, false);
});

test("one-playthrough detector does not mistake a seek to the end and back for a loop", () => {
  let state = createPlaybackState();
  ({ state } = sample(state, 10));
  ({ state } = sample(state, 59.8)); // jump is too large to be natural playback
  const result = sample(state, 0.2);

  assert.equal(result.completedOnePlaythrough, false);
});

test("one-playthrough detector does not arm immediately after resuming from a paused seek", () => {
  let state = createPlaybackState();
  ({ state } = sample(state, 59.6, 60, true));
  ({ state } = sample(state, 59.8));
  const result = sample(state, 0.1);

  assert.equal(result.completedOnePlaythrough, false);
});

test("one-playthrough detector stays false while playback time does not advance", () => {
  let state = createPlaybackState();
  ({ state } = sample(state, 40));
  ({ state } = sample(state, 40));
  ({ state } = sample(state, 40));

  assert.equal(state.completedOnePlaythrough, false);
});

test("activeCueIndex uses the same sampled playback time for cue highlighting", () => {
  const cues = [
    { startSeconds: 0, endSeconds: 2 },
    { startSeconds: 2, endSeconds: 5 },
  ];

  assert.equal(activeCueIndex(cues, 0), 0);
  assert.equal(activeCueIndex(cues, 2), 1);
  assert.equal(activeCueIndex(cues, 5), -1);
});
