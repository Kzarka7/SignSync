// Chooses which hand landmarker runs on each live frame.
//
// A two-hand MediaPipe landmarker re-runs its full-frame palm detector on
// every frame while it tracks fewer than two hands, looking for the missing
// one. When only one hand is in view that search costs a few FPS on
// integrated graphics. A one-hand landmarker that tracks its hand skips the
// palm detector entirely.
//
// The two-hand model stays the primary tracker. After it reports exactly one
// hand for ENTER_AFTER frames in a row, the one-hand model takes over, but
// the two-hand model still runs every SEARCH_EVERY frames so a second hand is
// picked up within a few frames. Finding two hands, or losing the tracked
// hand, returns to the two-hand model immediately.

export type HandCapacity = 1 | 2

export const HAND_CAPACITY_ENTER_AFTER = 3
export const HAND_CAPACITY_SEARCH_EVERY = 3

export function createHandCapacityController({
  enterAfter = HAND_CAPACITY_ENTER_AFTER,
  searchEvery = HAND_CAPACITY_SEARCH_EVERY,
} = {}) {
  let single = false
  let oneHandStreak = 0
  let sinceSearch = 0

  function reset() {
    single = false
    oneHandStreak = 0
    sinceSearch = 0
  }

  return {
    // Capacity of the model to run on the next frame.
    next(): HandCapacity {
      if (!single) return 2
      sinceSearch++
      if (sinceSearch >= searchEvery) {
        sinceSearch = 0
        return 2
      }
      return 1
    },
    // Reports how many hands the model that just ran returned.
    observe(capacity: HandCapacity, handCount: number) {
      if (capacity === 1) {
        if (handCount === 0) reset()
        return
      }
      if (handCount === 1) {
        oneHandStreak++
        if (!single && oneHandStreak >= enterAfter) {
          single = true
          sinceSearch = 0
        }
      } else {
        reset()
      }
    },
    reset,
    isSingle: () => single,
  }
}
