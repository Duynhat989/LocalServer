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
