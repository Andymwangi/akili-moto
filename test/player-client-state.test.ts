import { describe, expect, it } from 'vitest';
import { decideResume } from '../src/client/player-cache';
import { keepRecoveryCode, shareProfileData } from '../src/client/profile-data';

const playerId = '7f0c2c0e-3b1a-4d5e-9f00-111111111111';
const otherId = '7f0c2c0e-3b1a-4d5e-9f00-222222222222';
const code = 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-00000-11111';

describe('resume decision', () => {
  it('keeps a brand-new player on the name screen', () => {
    expect(
      decideResume({ displayName: 'Bright Otter 0001', isNewProfile: true, cached: null }),
    ).toEqual({ startGame: false, cache: { displayName: 'Bright Otter 0001', resume: false } });
  });

  it('resumes a player who started before in this browser', () => {
    expect(
      decideResume({
        displayName: 'Bright Otter 0001',
        isNewProfile: false,
        cached: { displayName: 'Bright Otter 0001', resume: true },
      }),
    ).toEqual({ startGame: true });
  });

  it('resumes and refreshes the cached name after a rename on another device', () => {
    expect(
      decideResume({
        displayName: 'New Name',
        isNewProfile: false,
        cached: { displayName: 'Old Name', resume: true },
      }),
    ).toEqual({ startGame: true, cache: { displayName: 'New Name', resume: true } });
  });

  it('treats a signed-in identity without a browser record as returning', () => {
    expect(decideResume({ displayName: 'Kind Zebra', isNewProfile: false, cached: null })).toEqual(
      { startGame: true, cache: { displayName: 'Kind Zebra', resume: true } },
    );
  });

  it('keeps a player who has not pressed start on the name screen', () => {
    expect(
      decideResume({
        displayName: 'Kind Zebra',
        isNewProfile: false,
        cached: { displayName: 'Kind Zebra', resume: false },
      }),
    ).toEqual({ startGame: false });
  });
});

describe('recovery code across profile refetches', () => {
  it('keeps the code when a refetch of the same player omits it', () => {
    const previous = { playerId, displayName: 'A', recoveryCode: code };
    const next = { playerId, displayName: 'A' };
    expect(keepRecoveryCode(previous, next)).toEqual({ ...next, recoveryCode: code });
  });

  it('shows a rotated code instead of the old one', () => {
    const rotated = 'FFFFF-EEEEE-DDDDD-CCCCC-BBBBB-AAAAA-11111-00000';
    expect(
      keepRecoveryCode(
        { playerId, displayName: 'A', recoveryCode: code },
        { playerId, displayName: 'A', recoveryCode: rotated },
      ),
    ).toMatchObject({ recoveryCode: rotated });
  });

  it("never carries one identity's code over to a restored identity", () => {
    const restored = { playerId: otherId, displayName: 'B' };
    expect(keepRecoveryCode({ playerId, displayName: 'A', recoveryCode: code }, restored)).toBe(
      restored,
    );
  });

  it('keeps the same object when nothing changed so effects do not re-run', () => {
    const previous = { playerId, displayName: 'A', recoveryCode: code };
    expect(shareProfileData(previous, { playerId, displayName: 'A' })).toBe(previous);
  });
});
