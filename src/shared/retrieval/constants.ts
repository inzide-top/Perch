/**
 * 向量列的维度属于数据库物理结构，不能在运行时随聊天模型变化。
 * 第一版统一使用 1024 维 Embedding；更换维度必须同时迁移数据库并重建索引。
 */
export const RETRIEVAL_EMBEDDING_DIMENSIONS = 1024
