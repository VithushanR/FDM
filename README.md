Road Safety AI System is a data mining project that uses UK Department for Transport STATS19 collision data (2021 to 2025, about 513,000 collisions).

Severity estimator. A random forest classifier takes the details of a reported collision (date and time, road, conditions, vehicles) and estimates whether the worst injury is Slight, Serious or Fatal. It runs behind a FastAPI backend with a web form.
Hotspot map. Spatial-temporal clustering finds where and when collisions concentrate, shown on a map.

Built for IT3051 Fundamentals of Data Mining, Mini Project 2026.
