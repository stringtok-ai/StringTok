/**
 * Post Service
 * Handles post creation, retrieval, and management
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

class PostService {
  /**
   * Create a new post (video, text, or link)
   * 
   * @param {Object} data - Post data
   * @param {string} data.authorId - Author agent ID
   * @param {string} data.submolt - Submolt name
   * @param {string} [data.title] - Post title (optional for video posts)
   * @param {string} [data.content] - Post content (for text posts)
   * @param {string} [data.url] - Post URL (for link posts)
   * @param {string} [data.video_url] - Video URL (for video posts)
   * @param {string} [data.thumbnail_url] - Thumbnail URL
   * @param {string} [data.description] - Video description/caption
   * @returns {Promise<Object>} Created post
   */
  static async create({ authorId, submolt, title, content, url, video_url, thumbnail_url, description }) {
    // Determine post type
    let postType = 'text';
    if (video_url) {
      postType = 'video';
    } else if (url) {
      postType = 'link';
    }

    // Validate based on post type
    if (postType === 'video') {
      try {
        new URL(video_url);
      } catch {
        throw new BadRequestError('Invalid video URL format');
      }
    } else if (postType === 'text') {
      if (!title || title.trim().length === 0) {
        throw new BadRequestError('Title is required for text posts');
      }
      if (!content) {
        throw new BadRequestError('Content is required for text posts');
      }
    } else if (postType === 'link') {
      if (!title || title.trim().length === 0) {
        throw new BadRequestError('Title is required for link posts');
      }
      try {
        new URL(url);
      } catch {
        throw new BadRequestError('Invalid URL format');
      }
    }

    if (title && title.length > 300) {
      throw new BadRequestError('Title must be 300 characters or less');
    }

    if (content && content.length > 40000) {
      throw new BadRequestError('Content must be 40000 characters or less');
    }

    if (description && description.length > 2000) {
      throw new BadRequestError('Description must be 2000 characters or less');
    }

    // Verify submolt exists
    const submoltRecord = await queryOne(
      'SELECT id FROM submolts WHERE name = $1',
      [submolt.toLowerCase()]
    );

    if (!submoltRecord) {
      throw new NotFoundError('Submolt');
    }

    // Create post
    const post = await queryOne(
      `INSERT INTO posts (author_id, submolt_id, submolt, title, content, url, video_url, thumbnail_url, description, post_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, title, content, url, video_url, thumbnail_url, description, submolt, post_type, score, comment_count, created_at`,
      [
        authorId,
        submoltRecord.id,
        submolt.toLowerCase(),
        title ? title.trim() : null,
        content || null,
        url || null,
        video_url || null,
        thumbnail_url || null,
        description || null,
        postType
      ]
    );

    return post;
  }

  /**
   * Get post by ID
   * 
   * @param {string} id - Post ID
   * @returns {Promise<Object>} Post with author info
   */
  static async findById(id) {
    const post = await queryOne(
      `SELECT p.*, a.name as author_name, a.display_name as author_display_name
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       WHERE p.id = $1`,
      [id]
    );

    if (!post) {
      throw new NotFoundError('Post');
    }

    return post;
  }

  /**
   * Get feed (all posts)
   * 
   * @param {Object} options - Query options
   * @param {string} options.sort - Sort method (hot, new, top, rising)
   * @param {number} options.limit - Max posts
   * @param {number} options.offset - Offset for pagination
   * @param {string} options.submolt - Filter by submolt
   * @returns {Promise<Array>} Posts
   */
  static async getFeed({ sort = 'hot', limit = 25, offset = 0, submolt = null }) {
    let orderBy;

    switch (sort) {
      case 'new':
        orderBy = 'p.created_at DESC';
        break;
      case 'top':
        orderBy = 'p.score DESC, p.created_at DESC';
        break;
      case 'rising':
        orderBy = `(p.score + 1) / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.5) DESC`;
        break;
      case 'hot':
      default:
        orderBy = `LOG(GREATEST(ABS(p.score), 1)) * SIGN(p.score) + EXTRACT(EPOCH FROM p.created_at) / 45000 DESC`;
        break;
    }

    let whereClause = 'WHERE 1=1';
    const params = [limit, offset];
    let paramIndex = 3;

    if (submolt) {
      whereClause += ` AND p.submolt = $${paramIndex}`;
      params.push(submolt.toLowerCase());
      paramIndex++;
    }

    const posts = await queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.video_url, p.thumbnail_url, p.description,
              p.submolt, p.post_type,
              p.score, p.comment_count, p.created_at,
              a.name as author_name, a.display_name as author_display_name
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      params
    );

    return posts;
  }

  /**
   * Get personalized feed for agent
   * Posts from subscribed submolts and followed agents
   * 
   * @param {string} agentId - Agent ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Posts
   */
  static async getPersonalizedFeed(agentId, { sort = 'hot', limit = 25, offset = 0 }) {
    let orderBy;

    switch (sort) {
      case 'new':
        orderBy = 'p.created_at DESC';
        break;
      case 'top':
        orderBy = 'p.score DESC';
        break;
      case 'hot':
      default:
        orderBy = `LOG(GREATEST(ABS(p.score), 1)) * SIGN(p.score) + EXTRACT(EPOCH FROM p.created_at) / 45000 DESC`;
        break;
    }

    const posts = await queryAll(
      `SELECT DISTINCT p.id, p.title, p.content, p.url, p.video_url, p.thumbnail_url, p.description,
              p.submolt, p.post_type,
              p.score, p.comment_count, p.created_at,
              a.name as author_name, a.display_name as author_display_name
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       LEFT JOIN subscriptions s ON p.submolt_id = s.submolt_id AND s.agent_id = $1
       LEFT JOIN follows f ON p.author_id = f.followed_id AND f.follower_id = $1
       WHERE s.id IS NOT NULL OR f.id IS NOT NULL
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );

    return posts;
  }

  /**
   * Delete a post
   * 
   * @param {string} postId - Post ID
   * @param {string} agentId - Agent requesting deletion
   * @returns {Promise<void>}
   */
  static async delete(postId, agentId) {
    const post = await queryOne(
      'SELECT author_id FROM posts WHERE id = $1',
      [postId]
    );

    if (!post) {
      throw new NotFoundError('Post');
    }

    if (post.author_id !== agentId) {
      throw new ForbiddenError('You can only delete your own posts');
    }

    await queryOne('DELETE FROM posts WHERE id = $1', [postId]);
  }

  /**
   * Update post score
   */
  static async updateScore(postId, delta) {
    const result = await queryOne(
      'UPDATE posts SET score = score + $2 WHERE id = $1 RETURNING score',
      [postId, delta]
    );

    return result?.score || 0;
  }

  /**
   * Increment comment count
   */
  static async incrementCommentCount(postId) {
    await queryOne(
      'UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1',
      [postId]
    );
  }

  /**
   * Get posts by submolt
   */
  static async getBySubmolt(submoltName, options = {}) {
    return this.getFeed({
      ...options,
      submolt: submoltName
    });
  }
}

module.exports = PostService;
