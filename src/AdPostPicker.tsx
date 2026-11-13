import { useState } from 'react';
import { Flag as FacebookIcon, Camera, Loader2, CheckCircle2, Ban, ExternalLink, Film, Megaphone, AlertTriangle } from 'lucide-react';
import { useApi, errorOf } from './queryClient';

// Ads phase I2: "Use an existing post" (server/adCreate.cjs listPosts). The post's own words and picture are the ad;
// the CRM adds the "Send WhatsApp message" button. Posts Meta says can't be promoted are shown greyed, with the reason.

export interface AdPost {
  source: 'facebook' | 'instagram'; id: string; caption: string; pictureUrl: string; permalink: string; igEligible: boolean;
}
/** The ads in this ad account already using the post (any made in Ads Manager too). */
interface PostUse { name: string; status: string }
interface ListedPost extends AdPost { kind: string; createdAt: string; eligible: boolean; reason: string; inAds?: PostUse[] }
const usedIn = (uses: PostUse[]) => `${uses.slice(0, 2).map(u => `“${u.name}” (${u.status})`).join(', ')}${uses.length > 2 ? ` and ${uses.length - 2} more` : ''}`;

const when = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };

type Source = 'facebook' | 'instagram';
function SourceTab({ id, label, Icon, active, onPick }: { id: Source; label: string; Icon: typeof Camera; active: Source; onPick: (s: Source) => void }) {
  return (
    <button type="button" role="tab" aria-selected={active === id} onClick={() => onPick(id)}
      className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer ${active === id ? 'bg-wa-teal text-white' : 'bg-slate-100 text-slate-600'}`}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

export default function AdPostPicker({ value, onPick, hasInstagram }: { value: AdPost | null; onPick: (p: AdPost) => void; hasInstagram: boolean }) {
  const [source, setSource] = useState<'facebook' | 'instagram'>(value?.source || (hasInstagram ? 'instagram' : 'facebook'));
  const q = useApi<{ posts: ListedPost[]; usageNote?: string | null }>(`/api/ads/create/posts?source=${source}`, { staleTime: 5 * 60000 });
  const posts = q.data?.posts || [];
  const error = errorOf(q);
  const chosenUses = (value && posts.find(p => p.id === value.id && p.source === value.source)?.inAds) || [];
  return (
    <div className="space-y-2" data-testid="ad-post-picker">
      <div className="flex gap-1.5" role="tablist" aria-label="Where the post is">
        <SourceTab id="facebook" label="Facebook Page posts" Icon={FacebookIcon} active={source} onPick={setSource} />
        {hasInstagram && <SourceTab id="instagram" label="Instagram posts" Icon={Camera} active={source} onPick={setSource} />}
      </div>
      {q.isLoading && <p className="text-xs text-slate-500 flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Asking Meta for your posts…</p>}
      {error && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700" role="alert">{error}</div>}
      {!q.isLoading && !error && !posts.length && <p className="text-xs text-slate-500">No posts found. Publish the post on {source === 'instagram' ? 'Instagram' : 'the Facebook Page'} first.</p>}
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[46vh] overflow-y-auto pr-1" aria-label="Posts">
        {posts.map(p => {
          const chosen = value?.id === p.id && value.source === p.source;
          return (
            <li key={p.id}>
              <button type="button" disabled={!p.eligible} aria-pressed={chosen} data-testid={`ad-post-${p.id}`}
                onClick={() => onPick({ source: p.source, id: p.id, caption: p.caption, pictureUrl: p.pictureUrl, permalink: p.permalink, igEligible: p.igEligible })}
                title={p.eligible ? '' : p.reason}
                className={`w-full text-left rounded-lg border overflow-hidden ${chosen ? 'border-wa-teal ring-2 ring-wa-teal' : 'border-slate-200 hover:border-wa-teal'} ${p.eligible ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                <div className="relative aspect-square bg-slate-100">
                  {p.pictureUrl ? <img src={p.pictureUrl} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">Text post</span>}
                  {/VIDEO|REELS/.test(p.kind) && <Film className="w-4 h-4 text-white absolute top-1.5 left-1.5 drop-shadow" />}
                  {chosen && <CheckCircle2 className="w-5 h-5 text-white bg-wa-teal rounded-full absolute top-1.5 right-1.5" />}
                  {!!p.inAds?.length && (
                    <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-amber-400 text-amber-950 text-xs font-bold flex items-center gap-1" data-testid="ad-post-in-ads">
                      <Megaphone className="w-3 h-3" /> Already in {p.inAds.length === 1 ? 'an ad' : `${p.inAds.length} ads`}
                    </span>
                  )}
                </div>
                <div className="p-1.5 text-xs">
                  <p className="text-slate-700 line-clamp-2 min-h-[2.4em]">{p.caption || <span className="text-slate-400">No caption</span>}</p>
                  <p className="text-slate-400 mt-0.5">{when(p.createdAt)}</p>
                  {!!p.inAds?.length && <p className="text-amber-800 mt-0.5 line-clamp-2">In {usedIn(p.inAds)}</p>}
                  {!p.eligible && <p className="text-red-700 mt-0.5 flex gap-1"><Ban className="w-3 h-3 flex-shrink-0 mt-px" /> {p.reason}</p>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {value && (
        <p className="text-xs text-slate-600" data-testid="ad-post-chosen">
          Chosen: the {value.source === 'instagram' ? 'Instagram' : 'Facebook'} post{value.caption ? ` “${value.caption.slice(0, 60)}${value.caption.length > 60 ? '…' : ''}”` : ''}.
          {value.permalink && <> <a href={value.permalink} target="_blank" rel="noreferrer" className="text-wa-teal font-semibold inline-flex items-center gap-0.5 hover:underline">Open <ExternalLink className="w-3 h-3" /></a></>}
        </p>
      )}
      {chosenUses.length > 0 && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex gap-1.5" role="note" data-testid="ad-post-in-ads-note">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          <span>This post is already in {usedIn(chosenUses)}. You can use it again: that ad isn&apos;t changed and the likes and comments add up on the post.
            But if both ads reach the same people, they compete with each other (higher cost, the same people see it twice). Choose another place or audience, or pause the other ad.</span>
        </div>
      )}
      {q.data?.usageNote && <p className="text-xs text-slate-400">{q.data.usageNote}</p>}
      <p className="text-xs text-slate-500">
        The post&apos;s own words and picture are the ad, and its likes and comments stay with it. The CRM adds the &quot;Send WhatsApp message&quot; button.
        Meta decides if a post can be an ad (shared posts, music or some formats can&apos;t); if it refuses, nothing is created and you see why.
      </p>
    </div>
  );
}
