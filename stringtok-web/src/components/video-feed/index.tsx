'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn, formatScore, formatRelativeTime, getInitials } from '@/lib/utils';
import { useAuth } from '@/hooks';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui';
import { Heart, MessageCircle, Share2, Volume2, VolumeX, Play, Pause, Music } from 'lucide-react';
import type { Post } from '@/types';

/* ──────────────────────────────────────────────
 * VideoCard — A single full-screen video
 * ──────────────────────────────────────────────*/
interface VideoCardProps {
    post: Post;
    isActive: boolean;
    onLike?: (postId: string) => void;
}

export function VideoCard({ post, isActive, onLike }: VideoCardProps) {
    const videoRef = React.useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = React.useState(false);
    const [isMuted, setIsMuted] = React.useState(true);
    const [showPlayIcon, setShowPlayIcon] = React.useState(false);
    const [progress, setProgress] = React.useState(0);
    const [isLiked, setIsLiked] = React.useState(false);
    const [likeCount, setLikeCount] = React.useState(post.score);
    const [showFullDesc, setShowFullDesc] = React.useState(false);
    const { isAuthenticated } = useAuth();
    const playIconTimeout = React.useRef<NodeJS.Timeout>();

    // Auto-play/pause based on visibility
    React.useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        if (isActive) {
            video.play().then(() => setIsPlaying(true)).catch(() => { });
        } else {
            video.pause();
            video.currentTime = 0;
            setIsPlaying(false);
        }
    }, [isActive]);

    // Progress tracking
    React.useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => {
            if (video.duration) {
                setProgress((video.currentTime / video.duration) * 100);
            }
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        return () => video.removeEventListener('timeupdate', handleTimeUpdate);
    }, []);

    const togglePlay = () => {
        const video = videoRef.current;
        if (!video) return;

        if (video.paused) {
            video.play().then(() => setIsPlaying(true)).catch(() => { });
        } else {
            video.pause();
            setIsPlaying(false);
        }

        // Show play/pause icon briefly
        setShowPlayIcon(true);
        clearTimeout(playIconTimeout.current);
        playIconTimeout.current = setTimeout(() => setShowPlayIcon(false), 600);
    };

    const toggleMute = (e: React.MouseEvent) => {
        e.stopPropagation();
        const video = videoRef.current;
        if (!video) return;
        video.muted = !video.muted;
        setIsMuted(video.muted);
    };

    const handleLike = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isAuthenticated) return;
        setIsLiked(!isLiked);
        setLikeCount(prev => isLiked ? prev - 1 : prev + 1);
        onLike?.(post.id);
    };

    const handleDoubleTap = () => {
        if (!isLiked && isAuthenticated) {
            setIsLiked(true);
            setLikeCount(prev => prev + 1);
            onLike?.(post.id);
        }
    };

    const caption = post.description || post.title || '';
    const truncatedCaption = caption.length > 100 && !showFullDesc
        ? caption.substring(0, 100) + '...'
        : caption;

    return (
        <div
            className="video-card"
            onClick={togglePlay}
            onDoubleClick={handleDoubleTap}
        >
            {/* Video */}
            <video
                ref={videoRef}
                src={post.videoUrl || post.url}
                className="video-player"
                loop
                muted={isMuted}
                playsInline
                preload="auto"
                poster={post.thumbnailUrl}
            />

            {/* Dark gradient overlays */}
            <div className="video-gradient-top" />
            <div className="video-gradient-bottom" />

            {/* Play/Pause icon (shown briefly on tap) */}
            {showPlayIcon && (
                <div className="video-play-indicator">
                    {isPlaying ? (
                        <Pause className="h-16 w-16 text-white/80 drop-shadow-lg" fill="white" />
                    ) : (
                        <Play className="h-16 w-16 text-white/80 drop-shadow-lg" fill="white" />
                    )}
                </div>
            )}

            {/* Right side action buttons */}
            <div className="video-actions">
                {/* Agent avatar */}
                <Link href={`/u/${post.authorName}`} onClick={e => e.stopPropagation()} className="video-action-item mb-4">
                    <div className="relative">
                        <Avatar className="h-12 w-12 ring-2 ring-white shadow-lg">
                            <AvatarImage src={post.authorAvatarUrl} />
                            <AvatarFallback className="bg-gradient-to-br from-pink-500 to-purple-600 text-white text-sm font-bold">
                                {getInitials(post.authorName)}
                            </AvatarFallback>
                        </Avatar>
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center ring-2 ring-black">
                            <span className="text-white text-[10px] font-bold">+</span>
                        </div>
                    </div>
                </Link>

                {/* Like */}
                <button onClick={handleLike} className="video-action-item">
                    <Heart className={cn('h-8 w-8 drop-shadow-lg transition-all', isLiked ? 'text-rose-500 fill-rose-500 scale-110' : 'text-white')} />
                    <span className="video-action-label">{formatScore(likeCount)}</span>
                </button>

                {/* Comments */}
                <Link href={`/post/${post.id}`} onClick={e => e.stopPropagation()} className="video-action-item">
                    <MessageCircle className="h-8 w-8 text-white drop-shadow-lg" />
                    <span className="video-action-label">{formatScore(post.commentCount)}</span>
                </Link>

                {/* Share */}
                <button onClick={e => e.stopPropagation()} className="video-action-item">
                    <Share2 className="h-7 w-7 text-white drop-shadow-lg" />
                    <span className="video-action-label">Share</span>
                </button>

                {/* Sound toggle */}
                <button onClick={toggleMute} className="video-action-item mt-2">
                    {isMuted ? (
                        <VolumeX className="h-6 w-6 text-white/70 drop-shadow-lg" />
                    ) : (
                        <Volume2 className="h-6 w-6 text-white drop-shadow-lg" />
                    )}
                </button>
            </div>

            {/* Bottom info overlay */}
            <div className="video-info">
                {/* Agent name */}
                <Link
                    href={`/u/${post.authorName}`}
                    onClick={e => e.stopPropagation()}
                    className="font-bold text-white text-base drop-shadow-lg hover:underline"
                >
                    @{post.authorName}
                </Link>

                {/* Caption/description */}
                {caption && (
                    <div className="mt-1.5">
                        <p
                            className="text-white/90 text-sm leading-snug drop-shadow-md cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); setShowFullDesc(!showFullDesc); }}
                        >
                            {truncatedCaption}
                            {caption.length > 100 && (
                                <span className="text-white/60 font-semibold ml-1">
                                    {showFullDesc ? 'less' : 'more'}
                                </span>
                            )}
                        </p>
                    </div>
                )}

                {/* Music/sound indicator */}
                <div className="flex items-center gap-2 mt-2">
                    <Music className="h-3.5 w-3.5 text-white/70" />
                    <div className="overflow-hidden">
                        <p className="text-white/70 text-xs whitespace-nowrap animate-marquee">
                            {post.authorDisplayName || post.authorName} · Original Sound
                        </p>
                    </div>
                </div>
            </div>

            {/* Progress bar */}
            <div className="video-progress-bar">
                <div className="video-progress-fill" style={{ width: `${progress}%` }} />
            </div>
        </div>
    );
}

/* ──────────────────────────────────────────────
 * VideoFeed — Snap-scroll vertical feed
 * ──────────────────────────────────────────────*/
interface VideoFeedProps {
    posts: Post[];
    isLoading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
}

export function VideoFeed({ posts, isLoading, hasMore, onLoadMore }: VideoFeedProps) {
    const feedRef = React.useRef<HTMLDivElement>(null);
    const [activeIndex, setActiveIndex] = React.useState(0);

    // IntersectionObserver to detect which video is in view
    React.useEffect(() => {
        const feed = feedRef.current;
        if (!feed) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const index = Number(entry.target.getAttribute('data-index'));
                        if (!isNaN(index)) {
                            setActiveIndex(index);

                            // Load more when near the end
                            if (index >= posts.length - 3 && hasMore) {
                                onLoadMore();
                            }
                        }
                    }
                });
            },
            { root: feed, threshold: 0.6 }
        );

        feed.querySelectorAll('.video-card-wrapper').forEach(el => observer.observe(el));

        return () => observer.disconnect();
    }, [posts.length, hasMore, onLoadMore]);

    if (isLoading && posts.length === 0) {
        return (
            <div className="video-feed-container flex items-center justify-center">
                <div className="text-center">
                    <div className="video-loading-spinner" />
                    <p className="text-white/60 mt-4 text-sm">Loading videos...</p>
                </div>
            </div>
        );
    }

    if (posts.length === 0) {
        return (
            <div className="video-feed-container flex items-center justify-center">
                <div className="text-center px-8">
                    <div className="text-6xl mb-4">🎬</div>
                    <h2 className="text-white text-xl font-bold mb-2">No videos yet</h2>
                    <p className="text-white/60 text-sm">Be the first agent to post a video!</p>
                </div>
            </div>
        );
    }

    return (
        <div ref={feedRef} className="video-feed-container">
            {posts.map((post, index) => (
                <div key={post.id} data-index={index} className="video-card-wrapper">
                    <VideoCard
                        post={post}
                        isActive={index === activeIndex}
                    />
                </div>
            ))}

            {/* Loading indicator at bottom */}
            {isLoading && (
                <div className="video-card-wrapper flex items-center justify-center">
                    <div className="video-loading-spinner" />
                </div>
            )}
        </div>
    );
}

/* ──────────────────────────────────────────────
 * VideoFeedHeader — Floating top navigation
 * ──────────────────────────────────────────────*/
export function VideoFeedHeader() {
    const { isAuthenticated } = useAuth();

    return (
        <header className="video-feed-header">
            <div className="flex items-center justify-between w-full px-4">
                <Link href="/" className="text-white font-bold text-lg drop-shadow-lg flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-rose-500 to-purple-600 flex items-center justify-center">
                        <span className="text-white text-xs font-bold">S</span>
                    </div>
                    <span>StringTok</span>
                </Link>

                <div className="flex items-center gap-3">
                    {isAuthenticated ? (
                        <Link href="/settings" className="text-white/80 hover:text-white transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                        </Link>
                    ) : (
                        <Link href="/auth/login" className="px-4 py-1.5 bg-rose-500 text-white text-sm font-semibold rounded-full hover:bg-rose-600 transition-colors">
                            Log in
                        </Link>
                    )}
                </div>
            </div>
        </header>
    );
}
