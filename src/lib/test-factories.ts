import type { Event, Fixture, Player, Team } from "./types";

let idSeq = 1;

export function makeTeam(overrides: Partial<Team> = {}): Team {
  const id = overrides.id ?? idSeq++;
  return {
    id,
    name: `Team ${id}`,
    short_name: `T${id}`,
    strength: 3,
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<Event> = {}): Event {
  const id = overrides.id ?? idSeq++;
  return {
    id,
    name: `Gameweek ${id}`,
    deadline_time: new Date(2026, 0, id).toISOString(),
    finished: false,
    is_current: false,
    is_next: false,
    ...overrides,
  };
}

export function makeFixture(overrides: Partial<Fixture> = {}): Fixture {
  const id = overrides.id ?? idSeq++;
  return {
    id,
    event: 1,
    team_h: 1,
    team_a: 2,
    team_h_difficulty: 3,
    team_a_difficulty: 3,
    kickoff_time: null,
    finished: false,
    team_h_score: null,
    team_a_score: null,
    ...overrides,
  };
}

export function makePlayer(overrides: Partial<Player> = {}): Player {
  const id = overrides.id ?? idSeq++;
  return {
    id,
    web_name: `Player ${id}`,
    first_name: "First",
    second_name: "Last",
    team: 1,
    element_type: 3,
    now_cost: 80,
    total_points: 0,
    points_per_game: "0.0",
    form: "0.0",
    ep_next: "0.0",
    selected_by_percent: "0.0",
    status: "a",
    chance_of_playing_next_round: null,
    news: "",
    minutes: 0,
    goals_scored: 0,
    assists: 0,
    clean_sheets: 0,
    bonus: 0,
    starts: 0,
    expected_goals: "0.0",
    expected_assists: "0.0",
    expected_goal_involvements: "0.0",
    expected_goals_per_90: 0,
    expected_assists_per_90: 0,
    expected_goal_involvements_per_90: 0,
    saves_per_90: 0,
    defensive_contribution_per_90: 0,
    ...overrides,
  };
}
