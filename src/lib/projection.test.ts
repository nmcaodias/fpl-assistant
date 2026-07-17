import { describe, expect, it } from "vitest";
import {
  availabilityAt,
  buildProjectionContext,
  findUpgrades,
  fixtureEase,
  formFactor,
  HIT_COST,
  projectPlayers,
  summariseHistories,
  summariseRecent,
  WORTH_A_HIT_GAIN,
} from "./projection";
import {
  makeEvent,
  makeFixture,
  makeHistoryRow,
  makePlayer,
  makeTeam,
} from "./test-factories";

describe("buildProjectionContext", () => {
  it("picks the event flagged is_next", () => {
    const events = [
      makeEvent({ id: 1, finished: true }),
      makeEvent({ id: 2, finished: false, is_next: true }),
      makeEvent({ id: 3, finished: false }),
    ];
    const ctx = buildProjectionContext([], events, []);
    expect(ctx.nextGw).toBe(2);
  });

  it("falls back to the first unfinished event when none is flagged is_next", () => {
    const events = [
      makeEvent({ id: 1, finished: true }),
      makeEvent({ id: 2, finished: false }),
      makeEvent({ id: 3, finished: false }),
    ];
    const ctx = buildProjectionContext([], events, []);
    expect(ctx.nextGw).toBe(2);
  });

  it("marks the season finished when every event is finished", () => {
    const events = [makeEvent({ id: 1, finished: true }), makeEvent({ id: 2, finished: true })];
    const ctx = buildProjectionContext([], events, []);
    expect(ctx.nextGw).toBeNull();
    expect(ctx.seasonFinished).toBe(true);
  });

  it("uses the max event id for lastGw, defaulting to 38 with no events", () => {
    expect(buildProjectionContext([], [], []).lastGw).toBe(38);
    expect(
      buildProjectionContext([], [makeEvent({ id: 5 }), makeEvent({ id: 12 })], []).lastGw,
    ).toBe(12);
  });

  it("builds per-team upcoming fixtures sorted by event, excluding finished and past ones", () => {
    const events = [makeEvent({ id: 2, is_next: true })];
    const fixtures = [
      makeFixture({ id: 1, event: 1, team_h: 10, team_a: 20, finished: true }),
      makeFixture({
        id: 2,
        event: 3,
        team_h: 10,
        team_a: 20,
        team_h_difficulty: 4,
        team_a_difficulty: 2,
      }),
      makeFixture({
        id: 3,
        event: 2,
        team_h: 20,
        team_a: 10,
        team_h_difficulty: 5,
        team_a_difficulty: 1,
      }),
    ];
    const ctx = buildProjectionContext(fixtures, events, []);

    expect(ctx.upcomingByTeam[10]).toEqual([
      { event: 2, opponent: 20, isHome: false, difficulty: 1 },
      { event: 3, opponent: 20, isHome: true, difficulty: 4 },
    ]);
    expect(ctx.upcomingByTeam[20]).toEqual([
      { event: 2, opponent: 10, isHome: true, difficulty: 5 },
      { event: 3, opponent: 10, isHome: false, difficulty: 2 },
    ]);
  });

  it("computes conceded-per-match from finished fixtures with scores", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const teams = [makeTeam({ id: 10 }), makeTeam({ id: 20 }), makeTeam({ id: 30 })];
    const fixtures = [
      makeFixture({ team_h: 10, team_a: 20, finished: true, team_h_score: 1, team_a_score: 3 }),
      makeFixture({ team_h: 20, team_a: 10, finished: true, team_h_score: 0, team_a_score: 0 }),
      // Unfinished fixture with scores should be ignored.
      makeFixture({ team_h: 10, team_a: 20, finished: false, team_h_score: 5, team_a_score: 5 }),
    ];
    const ctx = buildProjectionContext(fixtures, events, teams);

    // Team 10 conceded 3 (as home) + 0 (as away) over 2 games = 1.5
    expect(ctx.concededPerMatch[10]).toBe(1.5);
    // Team 20 conceded 1 + 0 over 2 games = 0.5
    expect(ctx.concededPerMatch[20]).toBe(0.5);
    // Team 30 played no finished games -> league-average prior
    expect(ctx.concededPerMatch[30]).toBe(1.3);
  });

  it("ignores finished fixtures missing a score", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const teams = [makeTeam({ id: 10 })];
    const fixtures = [
      makeFixture({ team_h: 10, team_a: 20, finished: true, team_h_score: null, team_a_score: null }),
    ];
    const ctx = buildProjectionContext(fixtures, events, teams);
    expect(ctx.gamesPlayed[10] ?? 0).toBe(0);
    expect(ctx.concededPerMatch[10]).toBe(1.3);
  });
});

describe("fixtureEase", () => {
  it("returns null once the season has finished", () => {
    const ctx = buildProjectionContext([], [makeEvent({ id: 1, finished: true })], []);
    expect(fixtureEase(ctx, 10, 5)).toBeNull();
  });

  it("returns null when the team has no fixtures in the window", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const ctx = buildProjectionContext([], events, []);
    expect(fixtureEase(ctx, 10, 5)).toBeNull();
  });

  it("averages (5 - difficulty) / 4 over fixtures within the horizon", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const fixtures = [
      makeFixture({ event: 1, team_h: 10, team_a: 20, team_h_difficulty: 2 }),
      makeFixture({ event: 2, team_h: 10, team_a: 20, team_h_difficulty: 4 }),
      // Outside a horizon of 2 starting at GW1 (event < 1 + 2 = 3 passes; use GW4 to exclude)
      makeFixture({ event: 4, team_h: 10, team_a: 20, team_h_difficulty: 5 }),
    ];
    const ctx = buildProjectionContext(fixtures, events, []);
    // (5-2)/4 = 0.75, (5-4)/4 = 0.25 -> average 0.5
    expect(fixtureEase(ctx, 10, 2)).toBeCloseTo(0.5, 5);
  });
});

describe("availabilityAt", () => {
  it("returns the base availability immediately (0 gameweeks ahead)", () => {
    expect(availabilityAt(makePlayer({ status: "d" }), 0.75, 0)).toBeCloseTo(0.75, 5);
  });

  it("recovers doubtful/injured players linearly to full fitness by 4 gameweeks", () => {
    const base = 0.5;
    const player = makePlayer({ status: "i" });
    expect(availabilityAt(player, base, 2)).toBeCloseTo(0.5 + 0.5 * 0.5, 5);
    expect(availabilityAt(player, base, 4)).toBeCloseTo(1, 5);
    expect(availabilityAt(player, base, 10)).toBeCloseTo(1, 5); // clamped, doesn't exceed 1
  });

  it("never recovers players who are unregistered ('u') or not in the squad ('n')", () => {
    expect(availabilityAt(makePlayer({ status: "u" }), 0.1, 10)).toBe(0.1);
    expect(availabilityAt(makePlayer({ status: "n" }), 0.1, 10)).toBe(0.1);
  });
});

describe("formFactor", () => {
  it("is neutral (1) when recent form matches the season baseline", () => {
    expect(formFactor(5, 5, 900, "a")).toBe(1);
  });

  it("boosts a player whose recent form beats their season baseline, halfway", () => {
    // form 8 vs ppg 4 -> ratio 2, factor 1 + (2-1)*0.5 = 1.5
    expect(formFactor(8, 4, 900, "a")).toBeCloseTo(1.5, 5);
  });

  it("cuts a player whose recent form trails their season baseline, halfway", () => {
    // form 2 vs ppg 4 -> ratio 0.5, factor 1 + (0.5-1)*0.5 = 0.75
    expect(formFactor(2, 4, 900, "a")).toBeCloseTo(0.75, 5);
  });

  it("clamps to the [0.6, 1.6] band for extreme streaks", () => {
    expect(formFactor(0, 5, 900, "a")).toBe(0.6); // ice cold, would be 0.5
    expect(formFactor(20, 4, 900, "a")).toBe(1.6); // red hot, would be 3.0
  });

  it("stays neutral without a reliable season baseline or when flagged", () => {
    expect(formFactor(8, 0.5, 900, "a")).toBe(1); // ppg under 1
    expect(formFactor(8, 4, 45, "a")).toBe(1); // under 90 minutes
    expect(formFactor(8, 4, 900, "d")).toBe(1); // doubtful — availabilityAt owns this
    expect(formFactor(0, 4, 900, "i")).toBe(1); // injured — not double-counted
  });
});

describe("summariseRecent", () => {
  it("totals a window's matches, minutes and underlying stats", () => {
    const w = summariseRecent([
      makeHistoryRow({ minutes: 90, starts: 1, expected_goals: "0.4", bonus: 3 }),
      makeHistoryRow({ minutes: 45, starts: 0, expected_assists: "0.2", saves: 2 }),
      makeHistoryRow({ minutes: 0, starts: 0, defensive_contribution: 0 }),
    ]);
    expect(w).toEqual({
      matches: 3,
      minutes: 135,
      starts: 1,
      xg: 0.4,
      xa: 0.2,
      dc: 0,
      saves: 2,
      bonus: 3,
    });
  });

  it("counts an unused match as a match with zero minutes", () => {
    // The denominator is team matches, so benched games must drag the average
    // down rather than vanish.
    const w = summariseRecent([
      makeHistoryRow({ minutes: 90 }),
      makeHistoryRow({ minutes: 0, starts: 0 }),
    ]);
    expect(w.matches).toBe(2);
    expect(w.minutes).toBe(90);
  });

  it("summarises a histories map keyed by numeric player id", () => {
    const map = summariseHistories({ 7: [makeHistoryRow({ minutes: 90 })] });
    expect(map.get(7)?.minutes).toBe(90);
  });
});

describe("projectPlayers", () => {
  it("computes epPerMatch from underlying rates for a fully available, fully-minuted player", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const player = makePlayer({
      team: 30, // no finished games -> 1.3 default conceded/match
      element_type: 3,
      status: "a",
      minutes: 90,
      expected_goals_per_90: 0.5,
      expected_assists_per_90: 0.2,
      bonus: 0.3,
      defensive_contribution_per_90: 0,
    });
    const ctx = buildProjectionContext([], events, []);
    // One finished game so xMins = minutes / gamesPlayed = 90 / 1 = 90.
    ctx.gamesPlayed[30] = 1;

    const proj = projectPlayers([player], ctx, 5);
    const p = proj.get(player.id)!;
    expect(p.xMins).toBe(90);
    expect(p.epPerMatch).toBeCloseTo(5.7, 5);
  });

  it("falls back to epPerMatch × horizon when the season has no more fixtures", () => {
    const events = [makeEvent({ id: 1, finished: true })]; // no next GW
    const player = makePlayer({ status: "a", minutes: 90 });
    const ctx = buildProjectionContext([], events, []);
    ctx.gamesPlayed[player.team] = 1;

    const proj = projectPlayers([player], ctx, 5);
    const p = proj.get(player.id)!;
    expect(p.perGw).toEqual([]);
    // horizonEp is rounded from the unrounded epPerMatch × horizon, so it can
    // differ slightly from epPerMatch (already rounded) × horizon.
    expect(p.horizonEp).toBeCloseTo(p.epPerMatch * 5, 0);
  });

  it("sums both fixtures of a double gameweek", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const player = makePlayer({ team: 10, status: "a", minutes: 90 });
    const fixtures = [
      makeFixture({ event: 1, team_h: 10, team_a: 20 }),
      makeFixture({ event: 1, team_h: 30, team_a: 10 }),
    ];
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 1;

    const proj = projectPlayers([player], ctx, 1);
    const p = proj.get(player.id)!;
    expect(p.perGw).toHaveLength(1);
    expect(p.perGw[0].fixtures).toHaveLength(2);
    // A double gameweek should be worth roughly double a single one.
    expect(p.perGw[0].ep).toBeGreaterThan(p.epPerMatch * 1.5);
  });

  it("calibrates per-gameweek ep onto the actual-points scale", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const fixtures = [makeFixture({ event: 1, team_h: 10, team_a: 20 })];
    const player = makePlayer({ team: 10, status: "a", minutes: 900 });
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 10;

    const p = projectPlayers([player], ctx, 1).get(player.id)!;
    // epPerMatch is the raw baseline; a neutral single fixture at full
    // availability projects exactly that, so the week is 1.115 + 0.523×raw.
    expect(p.perGw[0].ep).toBeCloseTo(1.115 + 0.523 * p.epPerMatch, 1);
  });

  it("pulls optimistic projections down and pessimistic ones up", () => {
    // Regression to the mean cuts both ways. The correction's fixed point is
    // 1.115 / (1 − 0.523) ≈ 2.34 xPts: above it a projection is trimmed, below
    // it a player is credited with the returns fringe players actually manage.
    const events = [makeEvent({ id: 1, is_next: true })];
    const fixtures = [makeFixture({ event: 1, team_h: 10, team_a: 20 })];
    const base = { team: 10, status: "a" } as const;
    const star = makePlayer({ ...base, id: 1, minutes: 900, expected_goals_per_90: 0.8 });
    const fringe = makePlayer({ ...base, id: 2, minutes: 200 });
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 10;

    const proj = projectPlayers([star, fringe], ctx, 1);
    const a = proj.get(1)!;
    const b = proj.get(2)!;
    expect(a.epPerMatch).toBeGreaterThan(2.34);
    expect(a.perGw[0].ep).toBeLessThan(a.epPerMatch);
    expect(b.epPerMatch).toBeLessThan(2.34);
    expect(b.perGw[0].ep).toBeGreaterThan(b.epPerMatch);
  });

  it("shrinks the gap between two players without reordering them", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const fixtures = [makeFixture({ event: 1, team_h: 10, team_a: 20 })];
    const base = { team: 10, status: "a", minutes: 900 } as const;
    const star = makePlayer({ ...base, id: 1, expected_goals_per_90: 0.8 });
    const dud = makePlayer({ ...base, id: 2, expected_goals_per_90: 0.1 });
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 10;

    const proj = projectPlayers([star, dud], ctx, 1);
    const a = proj.get(1)!;
    const b = proj.get(2)!;
    // Order preserved — a straight line can't reorder anything.
    expect(a.horizonEp).toBeGreaterThan(b.horizonEp);
    // …but the gap is scaled by the slope, which is what the hit maths reads.
    const rawGap = a.epPerMatch - b.epPerMatch;
    expect(a.horizonEp - b.horizonEp).toBeCloseTo(0.523 * rawGap, 1);
  });

  it("does not credit calibration's baseline to a player who never features", () => {
    // The intercept stands for what a fringe player scrapes together when he
    // does play. Someone with no minutes at all must stay at zero, or the
    // deadwood you should be selling looks worth keeping.
    const events = [makeEvent({ id: 1, is_next: true })];
    const fixtures = [makeFixture({ event: 1, team_h: 10, team_a: 20 })];
    const unavailable = makePlayer({ team: 10, id: 1, status: "u", minutes: 0 });
    const neverPlays = makePlayer({ team: 10, id: 2, status: "a", minutes: 0 });
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 10;

    const proj = projectPlayers([unavailable, neverPlays], ctx, 5);
    expect(proj.get(1)!.horizonEp).toBe(0);
    expect(proj.get(2)!.horizonEp).toBe(0);
  });

  it("gives zero ep for a blank gameweek (no fixtures)", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const player = makePlayer({ team: 10, status: "a", minutes: 90 });
    const fixtures = [makeFixture({ event: 2, team_h: 10, team_a: 20 })]; // nothing in GW1
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 1;

    const proj = projectPlayers([player], ctx, 1);
    expect(proj.get(player.id)!.perGw[0].ep).toBe(0);
  });

  it("stops projecting at the season's last gameweek even if the horizon extends beyond it", () => {
    const events = [makeEvent({ id: 37, is_next: true }), makeEvent({ id: 38 })];
    const player = makePlayer({ team: 10, status: "a", minutes: 90 });
    const ctx = buildProjectionContext([], events, []);
    ctx.gamesPlayed[10] = 1;

    const proj = projectPlayers([player], ctx, 10);
    const gws = proj.get(player.id)!.perGw.map((g) => g.gw);
    expect(gws).toEqual([37, 38]);
  });

  it("scales perGw and horizonEp by recent form, and reports the factor", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const fixtures = [makeFixture({ event: 1, team_h: 10, team_a: 20 })];
    const base = {
      team: 10,
      status: "a",
      minutes: 900,
      expected_goals_per_90: 0.5,
      points_per_game: "4.0",
    } as const;
    const cold = makePlayer({ ...base, id: 1, form: "2.0" }); // ratio 0.5 -> 0.75
    const hot = makePlayer({ ...base, id: 2, form: "8.0" }); // ratio 2 -> 1.5
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 10;

    const proj = projectPlayers([cold, hot], ctx, 1);
    const c = proj.get(1)!;
    const h = proj.get(2)!;
    expect(c.form).toBeCloseTo(0.75, 5);
    expect(h.form).toBeCloseTo(1.5, 5);
    // epPerMatch is the pure season baseline, identical for both.
    expect(c.epPerMatch).toBeCloseTo(h.epPerMatch, 5);
    // The in-form player projects higher than the out-of-form one.
    expect(h.horizonEp).toBeGreaterThan(c.horizonEp);
  });

  it("lifts a mid-season starter whose season minutes understate their role", () => {
    // The flaw the recent window exists to fix: 10 team games, but he only
    // broke into the side for the last 5 — season average says ~45 minutes a
    // match, the recent window says 90.
    const events = [makeEvent({ id: 1, is_next: true })];
    const fixtures = [makeFixture({ event: 1, team_h: 10, team_a: 20 })];
    const player = makePlayer({ team: 10, status: "a", minutes: 450 });
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 10;

    const seasonOnly = projectPlayers([player], ctx, 1).get(player.id)!;
    const recent = new Map([
      [player.id, summariseRecent(Array.from({ length: 5 }, () => makeHistoryRow({ minutes: 90 })))],
    ]);
    const withRecent = projectPlayers([player], ctx, 1, recent).get(player.id)!;

    expect(seasonOnly.usedRecent).toBe(false);
    expect(seasonOnly.xMins).toBe(45);
    expect(withRecent.usedRecent).toBe(true);
    // 450 recent minutes -> w = 450/720 = 0.625, so 0.625*90 + 0.375*45 ≈ 73.
    expect(withRecent.xMins).toBe(73);
    expect(withRecent.horizonEp).toBeGreaterThan(seasonOnly.horizonEp);
  });

  it("weights a thin recent window toward the season baseline", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const fixtures = [makeFixture({ event: 1, team_h: 10, team_a: 20 })];
    const player = makePlayer({ team: 10, status: "a", minutes: 450 });
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 10;

    // One 90-minute cameo in a 5-match window: w = 90/360 = 0.25, so the
    // season's 45' should still dominate -> 0.25*18 + 0.75*45 ≈ 38.
    const rows = [
      makeHistoryRow({ minutes: 90 }),
      ...Array.from({ length: 4 }, () => makeHistoryRow({ minutes: 0, starts: 0 })),
    ];
    const recent = new Map([[player.id, summariseRecent(rows)]]);
    const p = projectPlayers([player], ctx, 1, recent).get(player.id)!;
    expect(p.xMins).toBe(38);
  });

  it("ignores a recent window with no minutes and falls back to form", () => {
    // A fit player who hasn't featured: the window can't produce a rate, so the
    // season rates plus the form proxy handle him instead.
    const events = [makeEvent({ id: 1, is_next: true })];
    const fixtures = [makeFixture({ event: 1, team_h: 10, team_a: 20 })];
    const player = makePlayer({
      team: 10,
      status: "a",
      minutes: 900,
      points_per_game: "5.0",
      form: "0.0", // dropped, not injured
    });
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 10;

    const recent = new Map([
      [
        player.id,
        summariseRecent(Array.from({ length: 5 }, () => makeHistoryRow({ minutes: 0, starts: 0 }))),
      ],
    ]);
    const p = projectPlayers([player], ctx, 1, recent).get(player.id)!;
    expect(p.usedRecent).toBe(false);
    expect(p.form).toBe(0.6); // form proxy still cuts him
  });

  it("drops the form proxy when a real recent window fed the rates", () => {
    // Both signals describe recency; applying them together would double-count.
    const events = [makeEvent({ id: 1, is_next: true })];
    const fixtures = [makeFixture({ event: 1, team_h: 10, team_a: 20 })];
    const player = makePlayer({
      team: 10,
      status: "a",
      minutes: 900,
      points_per_game: "5.0",
      form: "1.0", // would otherwise force the 0.6 floor
    });
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 10;

    const recent = new Map([
      [player.id, summariseRecent([makeHistoryRow({ minutes: 90 })])],
    ]);
    const p = projectPlayers([player], ctx, 1, recent).get(player.id)!;
    expect(p.usedRecent).toBe(true);
    expect(p.form).toBe(1);
  });

  it("projects only the players it is given a window for, leaving others on season rates", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const fixtures = [makeFixture({ event: 1, team_h: 10, team_a: 20 })];
    const base = { team: 10, status: "a", minutes: 450 } as const;
    const refined = makePlayer({ ...base, id: 1 });
    const plain = makePlayer({ ...base, id: 2 });
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 10;

    const recent = new Map([
      [1, summariseRecent(Array.from({ length: 5 }, () => makeHistoryRow({ minutes: 90 })))],
    ]);
    const proj = projectPlayers([refined, plain], ctx, 1, recent);
    expect(proj.get(1)!.usedRecent).toBe(true);
    expect(proj.get(2)!.usedRecent).toBe(false);
    expect(proj.get(2)!.xMins).toBe(45); // untouched season average
  });

  it("does not apply a form cut between seasons, when FPL zeroes everyone's form", () => {
    const events = [makeEvent({ id: 1, finished: true })]; // season over, nextGw null
    // A regular starter whose form is 0 only because there's no football on.
    const player = makePlayer({
      status: "a",
      minutes: 900,
      points_per_game: "5.0",
      form: "0.0",
    });
    const ctx = buildProjectionContext([], events, []);
    ctx.gamesPlayed[player.team] = 10;

    const p = projectPlayers([player], ctx, 5).get(player.id)!;
    expect(p.form).toBe(1); // neutral, not the 0.6 floor
    expect(p.horizonEp).toBeCloseTo(p.epPerMatch * 5, 0);
  });

  it("anchors only the nearest single-fixture gameweek toward FPL's ep_next", () => {
    const events = [makeEvent({ id: 1, is_next: true }), makeEvent({ id: 2 })];
    const fixtures = [
      makeFixture({ id: 1, event: 1, team_h: 10, team_a: 20 }),
      makeFixture({ id: 2, event: 2, team_h: 10, team_a: 20 }),
    ];
    const base = { team: 10, status: "a", minutes: 900 } as const;
    // Identical players apart from ep_next; a very high ep_next makes the pull
    // unmistakable and independent of the model's absolute level.
    const anchored = makePlayer({ ...base, id: 1, ep_next: "50.0" });
    const plain = makePlayer({ ...base, id: 2, ep_next: "0.0" });
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 10;

    const a = projectPlayers([anchored], ctx, 2).get(1)!;
    const b = projectPlayers([plain], ctx, 2).get(2)!;
    // GW1 (nearest, single fixture) is pulled up toward ep_next.
    expect(a.perGw[0].ep).toBeGreaterThan(b.perGw[0].ep + 5);
    // GW2 is not the nearest gameweek, so ep_next leaves it untouched.
    expect(a.perGw[1].ep).toBeCloseTo(b.perGw[1].ep, 5);
  });

  it("does not anchor a double gameweek to ep_next (it covers one match)", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const fixtures = [
      makeFixture({ id: 1, event: 1, team_h: 10, team_a: 20 }),
      makeFixture({ id: 2, event: 1, team_h: 30, team_a: 10 }),
    ];
    const base = { team: 10, status: "a", minutes: 900 } as const;
    const anchored = makePlayer({ ...base, id: 1, ep_next: "50.0" });
    const plain = makePlayer({ ...base, id: 2, ep_next: "0.0" });
    const ctx = buildProjectionContext(fixtures, events, []);
    ctx.gamesPlayed[10] = 10;

    const a = projectPlayers([anchored], ctx, 1).get(1)!;
    const b = projectPlayers([plain], ctx, 1).get(2)!;
    expect(a.perGw[0].fixtures).toHaveLength(2);
    // The high ep_next must not leak into a double gameweek.
    expect(a.perGw[0].ep).toBeCloseTo(b.perGw[0].ep, 5);
  });

  it("projects lower ep for a harder fixture than an easier one", () => {
    const events = [makeEvent({ id: 1, is_next: true })];
    const player = makePlayer({ team: 10, status: "a", minutes: 90, expected_goals_per_90: 0.6 });
    const easy = buildProjectionContext(
      [makeFixture({ event: 1, team_h: 10, team_a: 20, team_h_difficulty: 1, team_a_difficulty: 1 })],
      events,
      [],
    );
    const hard = buildProjectionContext(
      [makeFixture({ event: 1, team_h: 10, team_a: 20, team_h_difficulty: 5, team_a_difficulty: 5 })],
      events,
      [],
    );
    easy.gamesPlayed[10] = 1;
    hard.gamesPlayed[10] = 1;

    const epEasy = projectPlayers([player], easy, 1).get(player.id)!.perGw[0].ep;
    const epHard = projectPlayers([player], hard, 1).get(player.id)!.perGw[0].ep;
    expect(epEasy).toBeGreaterThan(epHard);
  });
});

describe("findUpgrades", () => {
  function projectionFor(player: ReturnType<typeof makePlayer>, horizonEp: number, xMins = 90) {
    return {
      player,
      xMins,
      epPerMatch: horizonEp,
      form: 1,
      usedRecent: false,
      perGw: [],
      horizonEp,
    };
  }

  it("only proposes same-position players that project more xPts", () => {
    const outgoing = projectionFor(makePlayer({ id: 1, element_type: 3, now_cost: 80 }), 10);
    const market = new Map([
      [2, projectionFor(makePlayer({ id: 2, element_type: 3, now_cost: 80 }), 15)],
      [3, projectionFor(makePlayer({ id: 3, element_type: 4, now_cost: 80 }), 20)], // wrong position
      [4, projectionFor(makePlayer({ id: 4, element_type: 3, now_cost: 80 }), 5)], // worse
    ]);
    const upgrades = findUpgrades(outgoing, market, new Set([1]), {}, 100);
    expect(upgrades.map((u) => u.candidate.player.id)).toEqual([2]);
  });

  it("excludes players already in the squad", () => {
    const outgoing = projectionFor(makePlayer({ id: 1, element_type: 3, now_cost: 80 }), 10);
    const market = new Map([
      [2, projectionFor(makePlayer({ id: 2, element_type: 3, now_cost: 80 }), 15)],
    ]);
    const upgrades = findUpgrades(outgoing, market, new Set([1, 2]), {}, 100);
    expect(upgrades).toEqual([]);
  });

  it("excludes candidates over budget (price + bank)", () => {
    const outgoing = projectionFor(makePlayer({ id: 1, element_type: 3, now_cost: 80 }), 10);
    const market = new Map([
      [2, projectionFor(makePlayer({ id: 2, element_type: 3, now_cost: 120 }), 15)],
    ]);
    expect(findUpgrades(outgoing, market, new Set([1]), {}, 100)).toEqual([]);
    expect(
      findUpgrades(outgoing, market, new Set([1]), {}, 120).map((u) => u.candidate.player.id),
    ).toEqual([2]);
  });

  it("excludes bench fodder under the 45-minute floor", () => {
    const outgoing = projectionFor(makePlayer({ id: 1, element_type: 3, now_cost: 80 }), 10);
    const market = new Map([
      [2, projectionFor(makePlayer({ id: 2, element_type: 3, now_cost: 80 }), 15, 30)],
    ]);
    expect(findUpgrades(outgoing, market, new Set([1]), {}, 100)).toEqual([]);
  });

  it("excludes unavailable ('u') and unregistered ('n') candidates", () => {
    const outgoing = projectionFor(makePlayer({ id: 1, element_type: 3, now_cost: 80 }), 10);
    const market = new Map([
      [2, projectionFor(makePlayer({ id: 2, element_type: 3, now_cost: 80, status: "u" }), 15)],
      [3, projectionFor(makePlayer({ id: 3, element_type: 3, now_cost: 80, status: "n" }), 15)],
    ]);
    expect(findUpgrades(outgoing, market, new Set([1]), {}, 100)).toEqual([]);
  });

  it("caps replacements at 3 per club, excluding the outgoing player's own slot", () => {
    const outgoingPlayer = makePlayer({ id: 1, element_type: 3, now_cost: 80, team: 99 });
    const outgoing = projectionFor(outgoingPlayer, 10);
    const market = new Map([
      [2, projectionFor(makePlayer({ id: 2, element_type: 3, now_cost: 80, team: 99 }), 15)],
    ]);
    // Squad already has 3 players from team 99, including the outgoing one -> room for 1 more.
    expect(
      findUpgrades(outgoing, market, new Set([1]), { 99: 3 }, 100).map((u) => u.candidate.player.id),
    ).toEqual([2]);
    // Squad has 3 players from team 99 *besides* the outgoing one -> no room.
    expect(findUpgrades(outgoing, market, new Set([1]), { 99: 4 }, 100)).toEqual([]);
  });

  it("sorts by horizonEp descending and respects the limit", () => {
    const outgoing = projectionFor(makePlayer({ id: 1, element_type: 3, now_cost: 80 }), 10);
    const market = new Map([
      [2, projectionFor(makePlayer({ id: 2, element_type: 3, now_cost: 80 }), 12)],
      [3, projectionFor(makePlayer({ id: 3, element_type: 3, now_cost: 80 }), 20)],
      [4, projectionFor(makePlayer({ id: 4, element_type: 3, now_cost: 80 }), 16)],
    ]);
    const upgrades = findUpgrades(outgoing, market, new Set([1]), {}, 100, 2);
    expect(upgrades.map((u) => u.candidate.player.id)).toEqual([3, 4]);
  });

  it("flags a hit as worthwhile only when the gain exceeds WORTH_A_HIT_GAIN", () => {
    const outgoing = projectionFor(makePlayer({ id: 1, element_type: 3, now_cost: 80 }), 10);
    const market = new Map([
      [2, projectionFor(makePlayer({ id: 2, element_type: 3, now_cost: 80 }), 10 + WORTH_A_HIT_GAIN)],
      [
        3,
        projectionFor(makePlayer({ id: 3, element_type: 3, now_cost: 80 }), 10 + WORTH_A_HIT_GAIN + 0.1),
      ],
    ]);
    const upgrades = findUpgrades(outgoing, market, new Set([1]), {}, 100);
    const notWorth = upgrades.find((u) => u.candidate.player.id === 2)!;
    const worth = upgrades.find((u) => u.candidate.player.id === 3)!;
    expect(notWorth.worthAHit).toBe(false); // exactly the threshold is not "more than"
    expect(worth.worthAHit).toBe(true);
  });

  it("does not call a swap hit-worthy merely for clearing the 4 points a hit costs", () => {
    // The bar is deliberately well above HIT_COST — see WORTH_A_HIT_GAIN.
    const outgoing = projectionFor(makePlayer({ id: 1, element_type: 3, now_cost: 80 }), 10);
    const market = new Map([
      [2, projectionFor(makePlayer({ id: 2, element_type: 3, now_cost: 80 }), 10 + HIT_COST + 1)],
    ]);
    const upgrades = findUpgrades(outgoing, market, new Set([1]), {}, 100);
    expect(upgrades[0].worthAHit).toBe(false);
  });
});
