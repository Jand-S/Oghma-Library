import { createContext, useContext } from "react";

/**
 * Which cover images are covered (blurred, with an eye to show them). The app decides (adult
 * novels, the reader's per-book choices); `Cover` only asks by image URL, so every screen follows.
 */
export type CoverPrivacy = {
  isConcealed: (src: string) => boolean;
  reveal: (src: string) => void;
};

const nothingConcealed: CoverPrivacy = { isConcealed: () => false, reveal: () => undefined };

export const CoverPrivacyContext = createContext<CoverPrivacy>(nothingConcealed);

export function useCoverPrivacy(): CoverPrivacy {
  return useContext(CoverPrivacyContext);
}
