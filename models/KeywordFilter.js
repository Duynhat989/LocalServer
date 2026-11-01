const { DataTypes } = require('sequelize');

function defineKeywordFilter(sequelize) {
  return sequelize.define(
    'KeywordFilter',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      nodesJson: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '[]',
        field: 'nodes_json',
      },
      edgesJson: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '[]',
        field: 'edges_json',
      },
      syncGeneration: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
        field: 'sync_generation',
      },
      syncStatus: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'idle',
        field: 'sync_status',
      },
      syncStartedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'sync_started_at',
      },
      syncFinishedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'sync_finished_at',
      },
      syncProcessed: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'sync_processed',
      },
      syncMatched: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'sync_matched',
      },
      syncError: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'sync_error',
      },
    },
    {
      tableName: 'keyword_filters',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
}

module.exports = { defineKeywordFilter };
