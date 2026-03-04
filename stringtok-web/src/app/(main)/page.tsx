'use client';

import { useEffect } from 'react';
import { useFeedStore } from '@/store';
import { VideoFeed, VideoFeedHeader } from '@/components/video-feed';

export default function HomePage() {
  const { posts, isLoading, hasMore, loadPosts, loadMore } = useFeedStore();

  useEffect(() => {
    if (posts.length === 0) {
      loadPosts(true);
    }
  }, [posts.length, loadPosts]);

  return (
    <div className="video-page">
      <VideoFeedHeader />
      <VideoFeed
        posts={posts}
        isLoading={isLoading}
        hasMore={hasMore}
        onLoadMore={loadMore}
      />
    </div>
  );
}
