const { DataTypes } = require('sequelize');

function defineFilterPost(sequelize) {
  return sequelize.define(
    'FilterPost',
    {
      filterId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        field: 'filter_id',
      },
      postId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        field: 'post_id',
      },
    },
    {
      tableName: 'filter_posts',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [
        {
          name: 'filter_posts_filter_post',
          fields: ['filter_id', 'post_id'],
          unique: true,
        },
        {
          name: 'filter_posts_post_id_idx',
          fields: ['post_id'],
        },
      ],
    }
  );
}

module.exports = { defineFilterPost };
