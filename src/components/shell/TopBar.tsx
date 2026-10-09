'use client';
// 상단 바 — 기획서 3장(계층 메뉴) + 4.0(프로필 드롭다운 · 편집모드 · 그리드 토글)
// 로고 클릭 = 메인 이동 (v1.5) · 상위 메뉴 클릭 = 첫 하위 페이지 이동 (v1.8)
// 편집모드 중 페이지 이동 시도 → 종료 확인 모달 (v1.8)
import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { boardEntries, useMenuSettings, buildMenu } from '@/lib/menuStore';
import { useBoards } from '@/lib/boardStore';
import { useSections, sectionMenuEntries } from '@/lib/sectionStore';
import { useCustomLinks, linkEntries } from '@/lib/linkStore';
import { useSiteSettings } from '@/lib/siteStore';
import { useAuth } from '@/lib/auth';
import { useMainStore } from '@/lib/mainStore';
import { useBlobUrl } from '@/lib/blobStore';
import { refreshPage } from '@/lib/pageRefresh';
import { useToast } from '@/components/ui/Toast';
import { KToggle } from '@/components/ui/Kit';
import {
  Notif, NotifType, NOTIF_EVENT, NOTIF_TYPE_LABEL,
  readNotifs, markRead, markAllRead, clearReadNotifs, notifSettings, setNotifSetting, syncNotifs, selfTestNotif,
} from '@/lib/notifStore';
import { subscribeTable } from '@/lib/db';

const BellIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M6 9.5a6 6 0 0 1 12 0c0 4.2 1.6 5.6 2.2 6.3H3.8C4.4 15.1 6 13.7 6 9.5Z" />
    <path d="M10 18.8a2.1 2.1 0 0 0 4 0" />
  </svg>
);

export function TopBar() {
  const { user, isAdmin, logout } = useAuth();
  const { editOn, editAvailable, gridOn, setGridOn, toggleEdit, requestExit, guardNav } = useMainStore();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuSet, , menuLoaded] = useMenuSettings(); // 메뉴 관리 (5.2) — 노출·순서·이름
  const { boards, loaded: boardsLoaded } = useBoards(); // 다중 게시판 (5.2) — 게시판 그룹에 동적 반영
  const { map: secMap } = useSections();
  const { links } = useCustomLinks();                 // 커스텀 링크 (v2.0 사용자 요청)
  // 저장 설정 로드 전에는 메뉴·로고를 그리지 않음 — 새로고침 시 기본 구성이 깜빡이는 것 방지 (v1.9)
  const ready = menuLoaded && boardsLoaded;
  const menu = ready
    ? buildMenu(menuSet, [...boardEntries(boards), ...sectionMenuEntries(secMap), ...linkEntries(links)], { loggedIn: !!user, isAdmin, id: user?.id })
    : [];
  const [site, , siteLoaded] = useSiteSettings();    // 로고 텍스트/서브/정렬 (5.2)
  const avatarSrc = useBlobUrl(user?.avatarUrl);     // 프로필 이미지 (마이페이지, v1.9)
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen && !notifOpen) return;
    const close = (e: MouseEvent) => {
      if (!userRef.current?.contains(e.target as Node)) { setMenuOpen(false); setNotifOpen(false); }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen, notifOpen]);

  // 알림 (4.13) — 발생 지점의 커스텀 이벤트로 갱신
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifVer, setNotifVer] = useState(0); // 설정 토글 리렌더용
  useEffect(() => {
    const load = () => { setNotifs(readNotifs()); setNotifVer(v => v + 1); };
    load();
    window.addEventListener(NOTIF_EVENT, load);
    window.addEventListener('storage', load); // 다른 탭
    return () => { window.removeEventListener(NOTIF_EVENT, load); window.removeEventListener('storage', load); };
  }, []);

  useEffect(() => {
    if (!user) return;
    void syncNotifs(user.id, true);
    const off = subscribeTable('notifications', () => void syncNotifs(user.id, true));
    const onFocus = () => void syncNotifs(user.id);
    window.addEventListener('focus', onFocus);
    return () => { off(); window.removeEventListener('focus', onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  const myNotifs = user ? notifs.filter(n => n.toUserId === user.id) : [];
  const unread = myNotifs.filter(n => !n.read);
  // 메뉴 점 — 안 읽은 알림이 가리키는 페이지 (해당 메뉴 뱃지, 4.13)
  const dotHrefs = new Set(unread.map(n => n.href));
  const fmtNd = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const mySet = user ? notifSettings(user.id) : null;
  void notifVer;

  const nav = (href: string) => {
    if (/^https?:\/\//.test(href)) { window.open(href, '_blank'); return; }
    if (guardNav(href)) return;
    const cur = pathname + window.location.search;
    if (href === cur) { refreshPage(); return; }
    router.push(href);
  };

  const gnbRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visCount, setVisCount] = useState(menu.length);
  const menuKey = menu.map(m => m.label).join('|');
  useEffect(() => {
    const gnbEl = gnbRef.current, mEl = measureRef.current;
    if (!gnbEl || !mEl) return;
    const GAP = 2;
    const compute = () => {
      const avail = gnbEl.clientWidth;
      const kids = Array.from(mEl.children) as HTMLElement[];
      if (avail <= 0) {
        setVisCount(kids.length - 1);
        return;
      }
      const moreW = kids[kids.length - 1]?.offsetWidth ?? 40;
      const widths = kids.slice(0, -1).map(k => k.offsetWidth);
      const total = widths.reduce((a, w) => a + w, 0) + GAP * Math.max(0, widths.length - 1);
      let count = widths.length;
      if (total > avail) {
        const limit = avail - moreW - GAP;
        let used = 0; count = 0;
        for (const w of widths) {
          if (used + w > limit) break;
          used += w + GAP; count++;
        }
      }
      setVisCount(c => (c === count ? c : count));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(gnbEl); ro.observe(mEl);
    window.addEventListener('resize', compute);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuKey]);
  const visMenu = menu.slice(0, visCount);
  const moreMenu = menu.slice(visCount);

  // OneSignal 알림 요청 함수
  const handlePushPermission = async () => {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const os = (window as any).OneSignal;
      if (os && os.Notifications && typeof os.Notifications.requestPermission === 'function') {
        try {
          await os.Notifications.requestPermission();
          alert('알림 허용 요청이 처리되었습니다.');
        } catch (e) {
          console.error(e);
        }
      } else {
        alert('알림 모듈을 불러오는 중입니다. 잠시 후 다시 눌러주세요.');
      }
    }
  };

  return (
    <header className="topbar">
      <div className="brand" onClick={() => nav('/')}>
        {siteLoaded && site.title}
        {siteLoaded && site.subtitle && <small className={`al-${site.align}`}>{site.subtitle}</small>}
      </div>

      <nav className="gnb" ref={gnbRef}>
        {visMenu.map(item =>
          item.children ? (
            <div className="grp" key={item.label}>
              <button onClick={() => nav(item.children![0].href)}>
                {item.label}{item.children.some(c => dotHrefs.has(c.href)) && <small className="nd">●</small>}
              </button>
              <div className="sub">
                {item.children.map(c => (
                  <button key={c.href} onClick={() => nav(c.href)}>
                    {c.label}{dotHrefs.has(c.href) && <small className="nd">●</small>}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              key={item.label}
              className={pathname === item.href ? 'on' : ''}
              onClick={() => nav(item.href!)}
            >
              {item.label}{dotHrefs.has(item.href!) && <small className="nd">●</small>}
            </button>
          )
        )}
        {moreMenu.length > 0 && (
          <div className="grp more">
            <button aria-label="더보기">
              ⋯{moreMenu.some(m => (m.children ?? [{ href: m.href! }]).some(c => dotHrefs.has(c.href!))) && <small className="nd">●</small>}
            </button>
            <div className="sub">
              {moreMenu.map(item =>
                item.children ? (
                  <div className="sub-grp" key={item.label}>
                    <div className="sub-cap">{item.label}</div>
                    {item.children.map(c => (
                      <button key={c.href} onClick={() => nav(c.href)}>
                        {c.label}{dotHrefs.has(c.href) && <small className="nd">●</small>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button key={item.label} onClick={() => nav(item.href!)}>
                    {item.label}{dotHrefs.has(item.href!) && <small className="nd">●</small>}
                  </button>
                )}
            </div>
          </div>
        )}
        <div className="gnb gnb-measure" ref={measureRef} aria-hidden>
          {menu.map(item => <button key={item.label} tabIndex={-1}>{item.label}{item.children && <span> ▾</span>}</button>)}
          <button tabIndex={-1}>⋯</button>
        </div>
      </nav>

      {editOn && pathname === '/' && (
        <button className="btn btn-ghost" style={{ height: 27, padding: '0 11px', fontSize: 10.5, whiteSpace: 'nowrap' }}
          onClick={() => window.dispatchEvent(new Event('ohome-add-widget'))}>＋ 위젯</button>
      )}
      <KToggle
        className={`grid-chip ${editOn && pathname === '/' ? 'show' : ''}`}
        label="그리드"
        checked={gridOn}
        onChange={setGridOn}
      />
      <span className={`edit-flag ${editOn ? 'show' : ''}`} onClick={() => requestExit()}>
        ✎ 편집중
      </span>

      {/* OneSignal 푸시 알림 켜기 버튼 */}
      <button
        type="button"
        className="btn btn-ghost"
        style={{ height: 27, padding: '0 10px', fontSize: 11, whiteSpace: 'nowrap', marginRight: 8 }}
        onClick={handlePushPermission}
      >
        🔔 앱 알림 켜기
      </button>

      {/* 사용자 영역 */}
      {user ? (
        <div className="user-wrap" ref={userRef}>
          <div className="user-chip" onClick={() => setMenuOpen(o => !o)}>
            <span className="badge-dot" data-n={String(Math.min(9, unread.length))}
              onClick={e => { e.stopPropagation(); setMenuOpen(false); setNotifOpen(o => !o); }}>
              <BellIcon />
            </span>
            <div className="avatar" style={!avatarSrc && user.avatarColor ? { background: user.avatarColor } : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {avatarSrc && <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            {user.nickname} <span style={{ fontSize: 9, color: '#8d939d' }}>▾</span>
          </div>
          <div className={`user-menu notif-menu ${notifOpen ? 'open' : ''}`}>
            <div className="nh">
              <b>알림</b>
              {unread.length > 0 && (
                <button className="all" onClick={() => markAllRead(user.id)}>모두 읽음</button>
              )}
              {myNotifs.some(n => n.read) && (
                <button className="all" onClick={() => clearReadNotifs(user.id)}>읽은 알림 정리</button>
              )}
            </div>
            {myNotifs.length === 0 && <p className="empty">알림이 없습니다</p>}
            {myNotifs.slice(0, 12).map(n => (
              <button key={n.id} className={`nt ${n.read ? 'rd' : ''}`}
                onClick={() => { markRead(n.id); setNotifOpen(false); nav(n.href); }}>
                <b>{n.title}</b>
                {n.body && <span>{n.body}</span>}
                <small>{fmtNd(n.date)}</small>
              </button>
            ))}
            {mySet && (
              <div className="nset">
                {(Object.keys(NOTIF_TYPE_LABEL) as NotifType[])
                  .filter(k => k !== 'guest' || isAdmin)
                  .map(k => (
                    <label key={k} className="row">
                      <span>{NOTIF_TYPE_LABEL[k]}</span>
                      <KToggle checked={mySet[k]} onChange={v => setNotifSetting(user.id, k, v)} />
                    </label>
                  ))}
                <button className="all" style={{ marginTop: 2 }}
                  onClick={async () => { toast(await selfTestNotif(user.id)); void syncNotifs(user.id, true); }}>
                  알림 전달 확인
                </button>
              </div>
            )}
          </div>
          <div className={`user-menu ${menuOpen ? 'open' : ''}`}>
            <button onClick={() => { setMenuOpen(false); nav('/mypage'); }}>정보수정</button>
            {isAdmin && (
              <>
                {(editAvailable || editOn) && (
                  <button onClick={() => { setMenuOpen(false); toggleEdit(); }}>
                    편집모드 {editOn ? '끄기' : '켜기'}
                  </button>
                )}
                <button onClick={() => { setMenuOpen(false); nav('/settings'); }}>환경설정</button>
              </>
            )}
            <button onClick={() => { setMenuOpen(false); logout(); }}>로그아웃</button>
          </div>
        </div>
      ) : (
        <button className="login-link" onClick={() => nav('/login')}>로그인</button>
      )}
    </header>
  );
}
