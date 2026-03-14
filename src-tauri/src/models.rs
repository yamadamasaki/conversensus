use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const SUPPORTED_VERSION: &str = "0.1.0";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodeStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EdgeStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphNode {
    pub id: String,
    pub content: String,
    /// Schema placeholder — present for ontology alignment; unused in Step 0 UI
    pub properties: HashMap<String, String>,
    pub style: NodeStyle,
    pub position: Position,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    /// General-purpose properties. Step 0 uses properties["label"] for edge labels.
    pub properties: HashMap<String, String>,
    pub style: EdgeStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Sheet {
    pub name: String,
    pub description: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileMetadata {
    pub name: String,
    pub description: String,
}

/// Top-level file format.
/// `sheets` is always an array for forward compatibility.
/// Step 0 enforces sheets.len() == 1 in storage validation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConversensusFile {
    pub version: String,
    pub file: FileMetadata,
    pub sheets: Vec<Sheet>,
}

impl ConversensusFile {
    pub fn new_empty(name: &str) -> Self {
        Self {
            version: SUPPORTED_VERSION.to_string(),
            file: FileMetadata {
                name: name.to_string(),
                description: String::new(),
            },
            sheets: vec![Sheet {
                name: "Sheet 1".to_string(),
                description: String::new(),
                nodes: vec![],
                edges: vec![],
            }],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_round_trip_empty_file() {
        let file = ConversensusFile::new_empty("Test");
        let json = serde_json::to_string(&file).expect("serialize");
        let restored: ConversensusFile = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(file, restored);
    }

    #[test]
    fn test_round_trip_with_nodes_and_edges() {
        let mut node_props = HashMap::new();
        node_props.insert("key".to_string(), "val".to_string());
        let mut edge_props = HashMap::new();
        edge_props.insert("label".to_string(), "causes".to_string());

        let file = ConversensusFile {
            version: SUPPORTED_VERSION.to_string(),
            file: FileMetadata {
                name: "Test".to_string(),
                description: "desc".to_string(),
            },
            sheets: vec![Sheet {
                name: "Sheet 1".to_string(),
                description: String::new(),
                nodes: vec![GraphNode {
                    id: "abc123".to_string(),
                    content: "Hello world".to_string(),
                    properties: node_props,
                    style: NodeStyle { color: Some("#ff0000".to_string()), width: None, height: None },
                    position: Position { x: 100.0, y: 200.0 },
                }],
                edges: vec![GraphEdge {
                    id: "edge1".to_string(),
                    source: "abc123".to_string(),
                    target: "abc123".to_string(),
                    properties: edge_props,
                    style: EdgeStyle { color: None, stroke_width: Some(2.0) },
                }],
            }],
        };

        let json = serde_json::to_string_pretty(&file).expect("serialize");
        let restored: ConversensusFile = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(file, restored);
    }

    #[test]
    fn test_sheets_is_array_in_json() {
        let file = ConversensusFile::new_empty("Test");
        let json = serde_json::to_string(&file).expect("serialize");
        let value: serde_json::Value = serde_json::from_str(&json).expect("parse");
        assert!(value["sheets"].is_array(), "sheets must be a JSON array");
        assert_eq!(value["sheets"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_version_field_present() {
        let file = ConversensusFile::new_empty("Test");
        let json = serde_json::to_string(&file).expect("serialize");
        let value: serde_json::Value = serde_json::from_str(&json).expect("parse");
        assert_eq!(value["version"], SUPPORTED_VERSION);
    }
}
