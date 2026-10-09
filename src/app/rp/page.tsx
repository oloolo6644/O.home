'use client';
// 역극 (4.9) — 실시간 채팅형. 모바일 말풍선 너비 확정 확장 & SEND 버튼 밀림 완전 방지
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useLocalList, newId } from '@/lib/postStore';
import {
  RpRoom, RpMessage, RP_SEED, rpLastDate, rpHasNew,
  RpMessageRow, RP_MSG_KEY, RP_MSG_SEED, messagesFor, rpMarkRead,
} from '@/lib/rpStore';
import { Modal, ConfirmModal, useConfirmDelete } from '@/components/ui/Modal';
import { KInput, KTextarea, KCheck } from '@/components/ui/Kit';
import { EditableDesc, PageTitle } from '@/components/ui/PageText';
import { useToast } from '@/components/ui/Toast';
import { useMembers } from '@/lib/members';
import { pushNotif } from '@/lib/notifStore';

/** 발화자 아바타 */
function AvatarDisplay({
  avatarData,
  nickname,
  bgColor = '#3a3d44',
  size = 36,
  onClick,
}: {
  avatarData?: string;
  nickname?: string;
  bgColor?: string;
  size?: number;
  onClick?: () => void;
}) {
  if (avatarData) {
    return (
      <div
        className="face"
        onClick={onClick}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          position: 'relative',
          cursor: onClick ? 'pointer' : 'default',
        }}
      >
        <img
          src={avatarData}
          alt={nickname ?? 'avatar'}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }

  return (
    <div
      className="face ph"
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        backgroundColor: bgColor,
        color: '#ffffff',
        fontSize: size * 0.45,
        fontWeight: 'bold',
        flexShrink: 0,
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {nickname ? nickname[0] : '?'}
    </div>
  );
}

const fmtHM = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** *지문* -> 기울임+회색, **강조** -> 굵게 파싱하는 함수 */
const renderFormattedText = (rawText: string) => {
  if (!rawText) return '';
  const html = rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em style="color: #a1a1aa; font-style: italic;">$1</em>')
    .replace(/\n/g, '<br/>');
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
};

export default function RpPage() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const del = useConfirmDelete();
  const pool = useMembers();
  const [rooms, setRooms, loaded] = useLocalList<RpRoom>('ohome.rp.v1', RP_SEED);
  const [msgRows, setMsgRows] = useLocalList<RpMessageRow>(RP_MSG_KEY, RP_MSG_SEED);
  const msgsOf = (r: RpRoom) => messagesFor(msgRows, r.id, r.messages);

  const [selId, setSelId] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState<'all' | 'ongoing' | 'done'>('ongoing');
  const [mListOpen, setMListOpen] = useState(false);
  const [mFocus, setMFocus] = useState(false);

  const [customAvatar, setCustomAvatar] = useLocalList<string>('ohome.rp.custom_avatar', []);
  const currentAvatar = customAvatar[0] || '';

  const [recentAvatars, setRecentAvatars] = useLocalList<string>('ohome.rp.recent_avatars', []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 모달 및 드래그 상태
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [rawImageSrc, setRawImageSrc] = useState<string>('');
  const [zoom, setZoom] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const VIEW_SIZE = 220; // 원형 미리보기 크기 (px)

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast('이미지 크기는 8MB 이하로 선택해 주세요');
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const res = evt.target?.result as string;
      if (res) {
        const img = new Image();
        img.onload = () => {
          setImgNaturalSize({ w: img.width, h: img.height });
          setRawImageSrc(res);
          setZoom(1);
          setOffset({ x: 0, y: 0 });
          setCropModalOpen(true);
        };
        img.src = res;
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCloseCropModal = () => {
    setCropModalOpen(false);
    setRawImageSrc('');
  };

  const getRenderBaseSize = () => {
    if (!imgNaturalSize.w || !imgNaturalSize.h) return { w: VIEW_SIZE, h: VIEW_SIZE };
    const aspect = imgNaturalSize.w / imgNaturalSize.h;
    if (aspect > 1) {
      return { w: VIEW_SIZE * aspect, h: VIEW_SIZE };
    } else {
      return { w: VIEW_SIZE, h: VIEW_SIZE / aspect };
    }
  };

  const clampOffset = (newX: number, newY: number, currentZoom: number) => {
    const base = getRenderBaseSize();
    const currentW = base.w * currentZoom;
    const currentH = base.h * currentZoom;

    const maxX = Math.max(0, (currentW - VIEW_SIZE) / 2);
    const maxY = Math.max(0, (currentH - VIEW_SIZE) / 2);

    return {
      x: Math.min(maxX, Math.max(-maxX, newX)),
      y: Math.min(maxY, Math.max(-maxY, newY)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const rawX = e.clientX - dragStart.x;
    const rawY = e.clientY - dragStart.y;
    setOffset(clampOffset(rawX, rawY, zoom));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX - offset.x, y: touch.clientY - offset.y });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rawX = touch.clientX - dragStart.x;
    const rawY = touch.clientY - dragStart.y;
    setOffset(clampOffset(rawX, rawY, zoom));
  };

  const handleZoomChange = (newZoom: number) => {
    setZoom(newZoom);
    setOffset(prev => clampOffset(prev.x, prev.y, newZoom));
  };

  const applyCroppedImage = () => {
    if (!rawImageSrc || !imgNaturalSize.w || !imgNaturalSize.h) return;
    const img = new Image();
    img.src = rawImageSrc;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const targetSize = 300;
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const scaleFactor = targetSize / VIEW_SIZE;
      const base = getRenderBaseSize();

      const drawW = base.w * zoom * scaleFactor;
      const drawH = base.h * zoom * scaleFactor;

      const centerX = targetSize / 2;
      const centerY = targetSize / 2;

      const drawX = centerX - drawW / 2 + offset.x * scaleFactor;
      const drawY = centerY - drawH / 2 + offset.y * scaleFactor;

      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      const croppedBase64 = canvas.toDataURL('image/jpeg', 0.92);

      setCustomAvatar([croppedBase64]);

      const updatedList = [croppedBase64, ...recentAvatars.filter(item => item !== croppedBase64)].slice(0, 3);
      setRecentAvatars(updatedList);

      handleCloseCropModal();
      toast('프로필 인장이 적용되었습니다');
    };
  };

  const memberIdsOf = (r: RpRoom) => r.memberIds ?? (r.createdBy ? [r.createdBy] : []);

  const allMine = useMemo(() => (user
    ? rooms.filter(r => memberIdsOf(r).includes(user.id))
      .sort((a, b) => rpLastDate(b, messagesFor(msgRows, b.id, b.messages))
        .localeCompare(rpLastDate(a, messagesFor(msgRows, a.id, a.messages))))
    : []), [rooms, user, msgRows]);
  const myRooms = useMemo(() => allMine.filter(r => fStatus === 'all' || r.status === fStatus), [allMine, fStatus]);
  const sel = myRooms.find(r => r.id === selId) ?? myRooms[0];
  const cntS = (s: 'all' | 'ongoing' | 'done') =>
    allMine.filter(r => s === 'all' || r.status === s).length;

  useEffect(() => {
    if (!sel || !user) return;
    rpMarkRead(sel.id, user.id);
  }, [sel?.id, user?.id, msgRows.length]);

  const msgsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sel?.id, msgRows.length]);

  const [text, setText] = useState('');
  const send = () => {
    if (!sel || !user) return;
    let t = text.trim();
    if (!t) return;
    let kind: RpMessage['kind'] = 'char';
    if (t.startsWith('/desc ')) { kind = 'desc'; t = t.slice(6).trim(); }
    if (!t) return;
    
    const m: RpMessage & { avatarData?: string } = {
      id: newId(),
      kind,
      authorId: user.id,
      text: t,
      date: new Date().toISOString(),
      avatarData: currentAvatar || undefined,
    };
    setMsgRows([...msgRows, { ...m, roomId: sel.id }]);
    rpMarkRead(sel.id, user.id, m.date);
    setText('');
    memberIdsOf(sel).filter(id => id !== user.id).forEach(id =>
      pushNotif({
        type: 'rp', toUserId: id, href: '/rp', dedupeKey: `rp:${sel.id}`,
        title: `역극 「${sel.title}」 새 메시지`,
        body: t.slice(0, 60),
      }));
  };

  const [editMsg, setEditMsg] = useState<RpMessage | null>(null);
  const [editText, setEditText] = useState('');
  const saveMsg = () => {
    if (!sel || !editMsg) return;
    if (!editText.trim()) { toast('내용을 입력해 주세요'); return; }
    const t = editText.trim();
    if (msgRows.some(x => x.id === editMsg.id)) {
      setMsgRows(msgRows.map(x => (x.id === editMsg.id ? { ...x, text: t } : x)));
    } else {
      setRooms(rooms.map(r => r.id === sel.id
        ? { ...r, messages: r.messages.map(m => m.id === editMsg.id ? { ...m, text: t } : m) } : r));
    }
    setEditMsg(null);
  };
  const removeMsg = (m: RpMessage) => {
    if (!sel) return;
    del.ask('이 메시지를 삭제하시겠습니까?', () => {
      if (msgRows.some(x => x.id === m.id)) setMsgRows(msgRows.filter(x => x.id !== m.id));
      else setRooms(rooms.map(r => r.id === sel.id
        ? { ...r, messages: r.messages.filter(x => x.id !== m.id) } : r));
    });
  };

  const [newOpen, setNewOpen] = useState(false);
  const [nTitle, setNTitle] = useState('');
  const [nMembers, setNMembers] = useState<string[]>([]);
  const createRoom = () => {
    if (!user) return;
    if (!nTitle.trim()) { toast('방 제목을 입력해 주세요'); return; }
    const members = Array.from(new Set([user.id, ...nMembers]));
    const room: RpRoom = {
      id: newId(), title: nTitle.trim(),
      memberIds: members, status: 'ongoing', isPublic: false,
      createdBy: user.id, created: new Date().toISOString(), lastRead: {}, messages: [],
    };
    setRooms([room, ...rooms]);
    setSelId(room.id);
    setNewOpen(false);
    setNTitle(''); setNMembers([]);
  };

  const canManage = sel && user && (sel.createdBy === user.id || isAdmin);
  const [endAsk, setEndAsk] = useState(false);

  const patchRoom = (p: Partial<RpRoom>) => {
    if (!sel) return;
    setRooms(rooms.map(r => r.id === sel.id ? { ...r, ...p } : r));
  };
  const removeRoom = () => {
    if (!sel) return;
    const count = msgsOf(sel).length;
    del.ask(`「${sel.title}」 방을 삭제하시겠습니까?`, () => {
      setRooms(rooms.filter(r => r.id !== sel.id));
      setMsgRows(msgRows.filter(x => x.roomId !== sel.id));
      setSelId(null);
    }, `대화 ${count}개도 함께 삭제됩니다.`);
  };

  const myMemberInfo = pool.find(p => p.id === user?.id);

  if (!loaded) return <section className="page" />;

  if (!user) {
    return (
      <section className="page">
        <div className="page-head"><PageTitle>ROLEPLAY</PageTitle>
          <EditableDesc k="rp-gate-desc" def="역극은 로그인한 참여자에게만 표시됩니다" always /></div>
      </section>
    );
  }

  const roomSub = (r: RpRoom) => [
    r.status === 'done' ? (r.isPublic ? '완결 · 공개 전환됨' : '완결') : '진행중',
  ].join(' · ');

  const renderBase = getRenderBaseSize();

  return (
    <section className={`page page-rp ${mFocus ? 'rp-focus' : ''}`}>
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleAvatarSelect}
      />

      <div className="page-head">
        <PageTitle>ROLEPLAY</PageTitle>
        <EditableDesc k="rp-desc" def="실시간 채팅형 · 참여자에게만 존재 노출 · 프로필 인장 발화" />
      </div>

      <div className={`rp-layout ${mListOpen ? 'mopen' : ''}`}>
        <button type="button" className="rp-mfold" onClick={() => setMListOpen(o => !o)}>
          <b>{sel ? sel.title : '방 목록'}</b>
          <small>MY ROOMS {myRooms.length} {mListOpen ? '▴' : '▾'}</small>
        </button>
        <div className="panel rp-rooms">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px 12px', flexShrink: 0 }}>
            <b style={{ fontSize: 12, letterSpacing: '.1em', color: 'var(--sub)' }}>MY ROOMS</b>
            <button className="btn btn-dark" style={{ padding: '0 12px', height: 30, fontSize: 11 }}
              onClick={() => setNewOpen(true)}>＋ NEW ROOM</button>
          </div>
          <div className="rp-rooms-list">
            {myRooms.map(r => (
              <div key={r.id} className={`rp-room ${sel?.id === r.id ? 'on' : ''}`}
                onClick={() => { setSelId(r.id); setMListOpen(false); }}>
                <b>{r.title} {rpHasNew(r, user.id, msgsOf(r)) && sel?.id !== r.id && <span className="new">N</span>}</b>
                <small>{roomSub(r)}</small>
              </div>
            ))}
            {myRooms.length === 0 && (
              <p className="hint" style={{ padding: '10px 6px 0' }}>
                {fStatus === 'all' ? '참여 중인 방이 없습니다' : '이 상태의 방이 없습니다'}
              </p>
            )}
          </div>
        </div>

        {/* 채팅 화면 */}
        <div className="panel rp-chat">
          {sel ? (
            <>
              <div className="rp-head">
                <div>
                  <b>{sel.title}</b>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="pill">{sel.status === 'done' ? (sel.isPublic ? '완결 · 공개' : '완결') : '진행중'}</span>
                  {canManage && sel.status === 'ongoing' && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                      onClick={() => setEndAsk(true)}>END</button>
                  )}
                  {canManage && sel.status === 'done' && (
                    <>
                      <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                        onClick={() => patchRoom({ status: 'ongoing', isPublic: false })}>REOPEN</button>
                      <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                        onClick={() => patchRoom({ isPublic: !sel.isPublic })}>
                        {sel.isPublic ? 'UNPUBLISH' : 'PUBLISH'}
                      </button>
                    </>
                  )}
                  {canManage && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                      onClick={removeRoom}>DELETE</button>
                  )}
                </div>
              </div>

              <div className="rp-msgs" ref={msgsRef} style={{ width: '100%', boxSizing: 'border-box' }}>
                {msgsOf(sel).map(m => {
                  const mine = m.authorId === user.id;
                  if (m.kind === 'desc') {
                    return (
                      <div key={m.id} className="msg-desc">
                        {renderFormattedText(m.text)}
                        {mine && (
                          <span className="m-act">
                            <button onClick={() => { setEditMsg(m); setEditText(m.text); }}>EDIT</button>
                            <button onClick={() => removeMsg(m)}>DEL</button>
                          </span>
                        )}
                      </div>
                    );
                  }

                  const authorMember = pool.find(p => p.id === m.authorId);
                  const nickname = authorMember?.nickname ?? '회원';
                  const msgAvatar = (m as { avatarData?: string }).avatarData;

                  return (
                    <div key={m.id} className={`msg ${mine ? 'me' : ''}`}>
                      <AvatarDisplay
                        avatarData={msgAvatar}
                        nickname={nickname}
                        size={36}
                      />
                      {/* 외부 CSS의 max-width 및 flex 오버라이드 고정 */}
                      <div
                        style={{
                          maxWidth: '85%',
                          width: 'auto',
                          flex: '0 1 auto',
                        }}
                      >
                        <div className="who">{nickname}</div>
                        {/* 말풍선 내부 글자를 완전히 왼쪽 정렬로 고정 */}
                        <div
                          className="bub"
                          style={{
                            textAlign: 'left',
                            wordBreak: 'break-word',
                            maxWidth: '100%',
                            boxSizing: 'border-box',
                            display: 'block',
                          }}
                        >
                          {renderFormattedText(m.text)}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--faint)', marginTop: 3 }}>
                          {fmtHM(m.date)}
                        </div>
                      </div>
                      {mine && (
                        <span className="m-act">
                          <button onClick={() => { setEditMsg(m); setEditText(m.text); }}>EDIT</button>
                          <button onClick={() => removeMsg(m)}>DEL</button>
                        </span>
                      )}
                    </div>
                  );
                })}
                {msgsOf(sel).length === 0 && (
                  <p className="hint" style={{ textAlign: 'center', marginTop: 30 }}>첫 메시지를 남겨보세요</p>
                )}
              </div>

              {sel.status === 'ongoing' && (
                <div
                  className="rp-input"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 8,
                  }}
                >
                  <div
                    className="char-pick"
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2,
                      flexShrink: 0,
                    }}
                    onClick={() => setCropModalOpen(true)}
                    title="클릭하여 인장 선택 및 변경"
                  >
                    <AvatarDisplay
                      avatarData={currentAvatar}
                      nickname={myMemberInfo?.nickname}
                      size={32}
                    />
                    <small style={{ fontWeight: 600, fontSize: 10 }}>
                      {myMemberInfo?.nickname ?? '나'}
                    </small>
                  </div>

                  {/* 텍스트 작성창 (최대 높이 지정으로 SEND 버튼 밀림 방지) */}
                  <KTextarea
                    style={{
                      minHeight: 44,
                      maxHeight: 120,
                      flex: 1,
                      overflowY: 'auto',
                      resize: 'none',
                    }}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onFocus={() => setMFocus(true)}
                    onBlur={() => setTimeout(() => setMFocus(false), 180)}
                  />

                  {/* SEND 버튼 위치 및 고정 */}
                  <button
                    className="btn btn-dark"
                    onClick={send}
                    style={{
                      flexShrink: 0,
                      height: 44,
                      padding: '0 16px',
                    }}
                  >
                    SEND
                  </button>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
              <p className="hint">방을 개설하면 여기에 채팅이 표시됩니다</p>
            </div>
          )}
        </div>

        <div className="panel tagside" style={{ padding: 16 }}>
          <h4>상태</h4>
          <div className={`tag ${fStatus === 'ongoing' ? 'on' : ''}`} onClick={() => setFStatus('ongoing')}>
            진행중 <small>{cntS('ongoing')}</small>
          </div>
          <div className={`tag ${fStatus === 'all' ? 'on' : ''}`} onClick={() => setFStatus('all')}>
            전체 <small>{cntS('all')}</small>
          </div>
          <div className={`tag ${fStatus === 'done' ? 'on' : ''}`} onClick={() => setFStatus('done')}>
            완결 <small>{cntS('done')}</small>
          </div>
        </div>
      </div>

      {/* 이미지 드래그 구역 지정 & 최근 사용 인장 선택 모달 */}
      <Modal
        open={cropModalOpen}
        onClose={handleCloseCropModal}
        small
        title="발화 인장 설정"
        actions={
          <>
            <button className="btn btn-ghost" onClick={handleCloseCropModal}>CANCEL</button>
            {rawImageSrc && (
              <button className="btn btn-dark" onClick={applyCroppedImage}>APPLY</button>
            )}
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          {/* 새 이미지 선택 버튼 */}
          <button
            className="btn btn-dark"
            style={{ width: '100%', height: 36, fontSize: 12 }}
            onClick={() => fileInputRef.current?.click()}
          >
            ＋ 컴퓨터/모바일에서 사진 불러오기
          </button>

          {/* 저장된 최근 인장 3개 선택 영역 */}
          {recentAvatars.length > 0 && (
            <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--sub)', marginBottom: 8, textAlign: 'center' }}>
                최근 사용한 인장
              </div>
              <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'center', gap: 12 }}>
                {recentAvatars.map((imgData, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      setCustomAvatar([imgData]);
                      handleCloseCropModal();
                      toast('인장이 변경되었습니다');
                    }}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      border: currentAvatar === imgData ? '2.5px solid var(--accent, #ffffff)' : '1px solid rgba(255,255,255,0.2)',
                      opacity: currentAvatar === imgData ? 1 : 0.65,
                      transition: 'all 0.15s ease',
                    }}
                    title={`최근 인장 ${idx + 1}`}
                  >
                    <img src={imgData} alt="recent" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 새 사진을 업로드했을 때만 자르기(편집/확대/위치) 박스 표시 */}
          {rawImageSrc && (
            <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--sub)' }}>사진 위치 및 확대 조절</div>
              
              <div
                style={{
                  width: VIEW_SIZE,
                  height: VIEW_SIZE,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  position: 'relative',
                  backgroundColor: '#181a1d',
                  boxShadow: '0 0 0 2px rgba(255,255,255,0.3)',
                  cursor: 'grab',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  touchAction: 'none',
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={() => setIsDragging(false)}
                onMouseLeave={() => setIsDragging(false)}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={() => setIsDragging(false)}
              >
                {/* 점선 가이드 원 */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderRadius: '50%',
                    border: '2px dashed rgba(255,255,255,0.85)',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}
                />

                <img
                  src={rawImageSrc}
                  alt="preview"
                  draggable={false}
                  style={{
                    width: renderBase.w,
                    height: renderBase.h,
                    minWidth: renderBase.w,
                    minHeight: renderBase.h,
                    maxWidth: 'none',
                    maxHeight: 'none',
                    objectFit: 'cover',
                    transform: `scale(${zoom}) translate(${offset.x / zoom}px, ${offset.y / zoom}px)`,
                    transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                  }}
                />
              </div>

              {/* 확대/축소 슬라이더 */}
              <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--sub)' }}>ZOOM</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={zoom}
                  onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: '#181a1d' }}
                />
                <span style={{ fontSize: 11, fontWeight: 'bold', width: 32 }}>{Math.round(zoom * 100)}%</span>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} small title="역극 방 개설"
        desc="비참여자에게는 방의 존재가 보이지 않습니다" dirty
        actions={<>
          <button className="btn btn-ghost" onClick={() => setNewOpen(false)}>CANCEL</button>
          <button className="btn btn-dark" onClick={createRoom}>ADD</button>
        </>}>
        <div style={{ display: 'grid', gap: 11 }}>
          <div>
            <label className="k-label" style={{ marginBottom: 5 }}>Title</label>
            <KInput value={nTitle} onChange={e => setNTitle(e.target.value)} />
          </div>
          <div>
            <label className="k-label" style={{ marginBottom: 7 }}>참여 회원 선택</label>
            <div style={{ display: 'grid', gap: 8 }}>
              {pool.filter(p => p.id !== user.id).map(p => (
                <KCheck key={p.id} label={p.nickname}
                  checked={nMembers.includes(p.id)}
                  onChange={v => setNMembers(ms => v ? [...ms, p.id] : ms.filter(x => x !== p.id))} />
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={editMsg !== null} onClose={() => setEditMsg(null)} small title="메시지 수정" dirty
        actions={<>
          <button className="btn btn-ghost" onClick={() => setEditMsg(null)}>CANCEL</button>
          <button className="btn btn-dark" onClick={() => saveMsg()}>SAVE</button>
        </>}>
        <KTextarea style={{ minHeight: 100 }} value={editText} onChange={e => setEditText(e.target.value)} />
      </Modal>

      <ConfirmModal open={endAsk} title="역극을 완결 처리하시겠습니까?"
        body="완결 후에는 공개 전환을 사용할 수 있습니다."
        onClose={() => setEndAsk(false)}
        buttons={[
          { label: 'END', kind: 'dark', onClick: () => { patchRoom({ status: 'done' }); setEndAsk(false); } },
          { label: 'CANCEL', kind: 'ghost', onClick: () => setEndAsk(false) },
        ]} />
      {del.element}
    </section>
  );
}
