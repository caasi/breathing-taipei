[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]["name"](24.85,121.30,25.25,121.75);
  way["highway"="motorway"]["ref"](24.85,121.30,25.25,121.75);
);
out tags geom;
