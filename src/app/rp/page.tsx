'use client';
// 역극 (4.9) — 실시간 채팅형. 발화자 인장 구역 지정 크롭 & 최근 인장 3개 저장 목록 연동
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

/** 발화자 아바타 (커스텀 업로드 이미지 or 동그란 초성 아바타) */
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
  const pool = useMembers(); // 전체 회원 정보
  const [rooms, setRooms, loaded] = useLocalList<RpRoom>('ohome.rp.v1', RP_SEED);
  const [msgRows, setMsgRows] = useLocalList<RpMessageRow>(RP_MSG_KEY, RP_MSG_SEED);
  const msgsOf = (r: RpRoom) => messagesFor(msgRows, r.id, r.messages);

  const [selId, setSelId] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState<'all' | 'ongoing' | 'done'>('ongoing');
  const [mListOpen, setMListOpen] = useState(false);
  const [mFocus, setMFocus] = useState(false);

  // 로컬에 저장되는 현재 선택된 커스텀 프사 (Base64)
  const [customAvatar, setCustomAvatar] = useLocalList<string>('ohome.rp.custom_avatar', []);
  const currentAvatar = customAvatar[0] || '';

  // 최근 사용한 인장 목록 (최대 3개 저장)
  const [recentAvatars, setRecentAvatars] = useLocalList<string>('ohome.rp.recent_avatars', []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 이미지 크롭/확대 모달 상태
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [rawImageSrc, setRawImageSrc] = useState<string>('');
  const [zoom, setZoom] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast('이미지 크기는 5MB 이하로 선택해 주세요');
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const res = evt.target?.result as string;
      if (res) {
        setRawImageSrc(res);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
        setCropModalOpen(true);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 구역 지정 크롭 이미지 적용
  const applyCroppedImage = () => {
    if (!rawImageSrc) return;
    const img = new Image();
    img.src = rawImageSrc;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 300; // 결과 이미지 해상도
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#181a1d';
      ctx.fillRect(0, 0, size, size);

      const aspect = img.width / img.height;
      let drawW = size * zoom;
      let drawH = (size / aspect) * zoom;
      if (aspect < 1) {
        drawW = (size * aspect) * zoom;
        drawH = size * zoom;
      }

      const drawX = (size - drawW) / 2 + offset.x;
      const drawY = (size - drawH) / 2 + offset.y;

      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      const croppedBase64 = canvas.toDataURL('image/jpeg', 0.88);

      // 현재 사용 인장으로 지정
      setCustomAvatar([croppedBase64]);

      // 최근 인장 목록 갱신 (중복 제거 후 상위 3개 유효 저장)
      const updatedList = [croppedBase64, ...recentAvatars.filter(item => item !== croppedBase64)].slice(0, 3);
      setRecentAvatars(updatedList);

      setCropModalOpen(false);
      toast('프로필 인장이 적용되었습니다');
    };
  };

  // 최근 사용한 인장 클릭하여 선택
  const selectRecentAvatar = (imgData: string) => {
    setCustomAvatar([imgData]);
    const updatedList = [imgData, ...recentAvatars.filter(item => item !== imgData)].slice(0, 3);
    setRecentAvatars(updatedList);
    toast('인장이 변경되었습니다');
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

              <div className="rp-msgs" ref={msgsRef}>
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
                      <div>
                        <div className="who">{nickname}</div>
                        <div className="bub">{renderFormattedText(m.text)}</div>
                        <div style={{ fontSize: 9, color: 'var(--faint)', marginTop: 3 }}>{fmtHM(m.date)}</div>
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
                <div className="rp-input" style={{ position: 'relative' }}>
                  {/* 발화자 인장 선택 및 최근 3개 선택 박스 */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
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
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      title="클릭하여 새 프로필 사진 지정"
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

                    {/* 최근 3개 인장 선택 스위처 */}
                    {recentAvatars.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          gap: 4,
                          padding: '2px 4px',
                          backgroundColor: 'rgba(255,255,255,0.05)',
                          borderRadius: 12,
                        }}
                      >
                        {recentAvatars.map((imgData, idx) => (
                          <div
                            key={idx}
                            onClick={() => selectRecentAvatar(imgData)}
                            title={`최근 인장 ${idx + 1}`}
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: '50%',
                              overflow: 'hidden',
                              cursor: 'pointer',
                              border: currentAvatar === imgData ? '2px solid var(--accent, #ffffff)' : '1px solid rgba(255,255,255,0.2)',
                              opacity: currentAvatar === imgData ? 1 : 0.6,
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <img src={imgData} alt="recent" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <KTextarea style={{ minHeight: 44 }} value={text} onChange={e => setText(e.target.value)}
                    onFocus={() => setMFocus(true)}
                    onBlur={() => setTimeout(() => setMFocus(false), 180)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                  <button className="btn btn-dark" onClick={send}>SEND</button>
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

      {/* 이미지 드래그 구역 지정 & 크롭 모달 */}
      <Modal
        open={cropModalOpen}
        onClose={() => setCropModalOpen(false)}
        small
        title="인장 구역 지정 및 확대 설정"
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setCropModalOpen(false)}>CANCEL</button>
            <button className="btn btn-dark" onClick={applyCroppedImage}>APPLY</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          {/* 사각 크롭 영역 가이드 포함 박스 */}
          <div
            style={{
              width: 200,
              height: 200,
              borderRadius: 8,
              overflow: 'hidden',
              position: 'relative',
              backgroundColor: '#181a1d',
              boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.2)',
              cursor: 'grab',
              userSelect: 'none',
            }}
            onMouseDown={(e) => {
              setIsDragging(true);
              setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
            }}
            onMouseMove={(e) => {
              if (!isDragging) return;
              setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
            }}
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
          >
            {/* 사각 크롭 가이드 프레임 */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: 160,
                height: 160,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                border: '2px dashed rgba(255,255,255,0.8)',
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />

            {rawImageSrc && (
              <img
                src={rawImageSrc}
                alt="preview"
                draggable={false}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: `scale(${zoom}) translate(${offset.x / zoom}px, ${offset.y / zoom}px)`,
                  transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                }}
              />
            )}
          </div>

          <p className="hint" style={{ margin: 0, fontSize: 11 }}>
            이미지를 드래그하여 원 안의 구역을 맞추세요
          </p>

          {/* 확대/축소 슬라이더 */}
          <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--sub)' }}>ZOOM</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: '#181a1d' }}
            />
            <span style={{ fontSize: 11, fontWeight: 'bold', width: 32 }}>{Math.round(zoom * 100)}%</span>
          </div>

          {/* 저장된 최근 인장 3개 목록 미리보기 */}
          {recentAvatars.length > 0 && (
            <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--sub)', marginBottom: 6 }}>최근 사용한 인장 (최대 3개)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {recentAvatars.map((imgData, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      setCustomAvatar([imgData]);
                      setCropModalOpen(false);
                      toast('최근 인장으로 변경되었습니다');
                    }}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      border: '2px solid rgba(255,255,255,0.3)',
                    }}
                  >
                    <img src={imgData} alt="recent" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
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
