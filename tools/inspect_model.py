import sys, warnings, joblib
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder

def encoders(t):
    if isinstance(t, OneHotEncoder): yield t
    elif hasattr(t, "steps"):
        for _, s in t.steps: yield from encoders(s)

for path in sys.argv[1:]:
    print("=" * 70); print(path)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        m = joblib.load(path)
    for w in caught:
        if "version" in str(w.message).lower():
            print("VERSION WARNING:", w.message); break
    print("type:", type(m).__name__)
    if not hasattr(m, "steps"):
        print("Not a Pipeline: the app cannot use it (it needs raw inputs)."); continue
    clf = m.steps[-1][1]
    print("steps:", [n for n, _ in m.steps], "| last step:", type(clf).__name__)
    print("classes_:", list(m.classes_), "| trees:", getattr(clf, "n_estimators", None))
    prep = next((s for _, s in m.steps if isinstance(s, ColumnTransformer)), None)
    if prep is None: print("No ColumnTransformer found."); continue
    print("input columns:", len(m.feature_names_in_))
    print("output features:", len(prep.get_feature_names_out()), "(116 = -1 as missing, 126 = -1 kept)")
    one_hot, has_minus_one = set(), False
    for name, t, cols in prep.transformers_:
        if name == "remainder" or isinstance(t, str): continue
        for enc in encoders(t):
            for c, cats in zip(cols, enc.categories_):
                one_hot.add(c)
                has_minus_one = has_minus_one or (-1 in list(cats))
    print("trunk_road_flag one-hot encoded:", "trunk_road_flag" in one_hot)
    print("an encoder contains -1:", has_minus_one)