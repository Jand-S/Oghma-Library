import { Gift, MessagesSquare, UserRound, Users } from "lucide-react";
import { socialStrings as t } from "../../strings/social";
import { EmptyState, SegmentedControl } from "../../ui";
import { ConversationsPane } from "./ConversationsPane";
import { FriendProfile } from "./FriendProfile";
import { FriendsPane } from "./FriendsPane";
import { RecommendationsPane } from "./RecommendationsPane";
import { SocialEnvContext, type SocialEnv, type SocialPlace, type SocialTab } from "./socialEnv";
import "./social.css";

/** Amigos: Conversas · Indicações · Amigos, and a friend's profile on top of them. */
export function SocialView({ env, place }: { env: SocialEnv; place: SocialPlace }) {
  const { social } = env;
  if (!social.available) {
    return (
      <div className="social-page social-page--empty">
        <EmptyState icon={<Users />} title={t.title} description={t.networkError} />
      </div>
    );
  }
  const count = (value: number) => (value ? ` · ${value}` : "");
  return (
    <SocialEnvContext.Provider value={env}>
      <div className="social-page" data-testid="social-page">
        {place.friend ? (
          <div className="social-page__scroll">
            <FriendProfile publicId={place.friend} />
          </div>
        ) : (
          <>
            <div className="social-page__bar">
              <SegmentedControl<SocialTab>
                aria-label={t.tabsLabel}
                value={place.tab}
                onChange={(tab) => env.go({ tab, chat: tab === "chats" ? place.chat : undefined })}
                options={[
                  { value: "chats", label: `${t.tabs.chats}${count(social.unreadMessages)}`, icon: <MessagesSquare /> },
                  { value: "recommendations", label: `${t.tabs.recommendations}${count(social.newRecommendations)}`, icon: <Gift /> },
                  { value: "friends", label: `${t.tabs.friends}${count(social.friends.incoming.length)}`, icon: <UserRound /> }
                ]}
              />
            </div>
            {place.tab === "chats" ? (
              <ConversationsPane chat={place.chat} />
            ) : (
              <div className="social-page__scroll">
                {place.tab === "recommendations" ? <RecommendationsPane /> : <FriendsPane />}
              </div>
            )}
          </>
        )}
      </div>
    </SocialEnvContext.Provider>
  );
}
