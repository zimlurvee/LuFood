"""Train the models and save the best one:  python train.py"""
import json
from app.ml import train

if __name__ == "__main__":
    b = train()
    print("Best model:", b["name"])
    print(json.dumps(b["metrics"], indent=2))
