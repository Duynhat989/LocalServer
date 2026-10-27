const { DataTypes } = require('sequelize');

function definePost(sequelize) {
  return sequelize.define(
    'Post',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      postId: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        field: 'post_id',
      },
      postMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'post_message',
      },
      postUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'post_url',
      },
      groupId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'group_id',
      },
      groupName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'group_name',
      },
      fbUserId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'fb_user_id',
      },
      userName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'user_name',
      },
      userUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'user_url',
      },
      phone: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      thesame: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      createdTime: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'created_time',
      },
      scannedAt: {
        type: DataTypes.BIGINT,
        allowNull: true,
        field: 'scanned_at',
      },
      keyword: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'posts',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
}

module.exports = { definePost };
